import assert from "node:assert/strict";
import test from "node:test";
import { readSection } from "../web/reader-pages.mjs";
import { ReaderPageCache, rememberPage, HISTORY_LIMIT } from "../web/reader-cache.mjs";
import { PagedTextReader } from "../web/reader.mjs";
import { SectionScanner } from "../web/reader-structure.mjs";

function serving(t, body, { chunk = 240, mutate } = {}) {
  const lines = body.split("\n"), calls = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const input = JSON.parse(init.body); calls.push(input);
    const to = Math.min(lines.length, input.from - 1 + Math.min(input.limit, chunk));
    const record = { token: "same-token", body: lines.slice(input.from - 1, to).join("\n"),
      lines: { from: input.from, to, total: lines.length, nextLine: to < lines.length ? to + 1 : null,
        truncated: input.from > 1 || to < lines.length } };
    return Response.json(mutate ? mutate(record) : record);
  });
  return calls;
}

test("最后响应闭合的巨型代码块不能绕过2MiB上限", async (t) => {
  const body = ["```text", ...Array(250).fill("x".repeat(9000)), "```", ""].join("\n");
  const calls = serving(t, body, { chunk: 100 });
  await assert.rejects(readSection("大书", "README.md"), (error) => error.status === 413 && error.code === "TEXT_BLOCK_TOO_LARGE");
  assert.equal(calls.length, 3);
});

test("十万短行普通段落一次只展示约200行，纯文本不解释Markdown围栏", async (t) => {
  const calls = serving(t, Array(100000).fill("短行").join("\n"));
  const record = await readSection("长文", "README.md");
  assert.equal(record.lines.to, 200);
  assert.equal(record.lines.nextLine, 201);
  assert.equal(calls.length, 1);
  t.mock.restoreAll();
  serving(t, ["```", "<table>", "<!--", ...Array(1000).fill("普通日志")].join("\n"));
  const text = await readSection("日志", undefined, { markdown: false });
  assert.equal(text.lines.to, 200);
});

test("错误续读游标立即失败，迟到的已取消响应不继续请求", async (t) => {
  const calls = serving(t, Array(1000).fill("行").join("\n"), { mutate: (record) => ({ ...record, lines: { ...record.lines, nextLine: 1 } }) });
  await assert.rejects(readSection("正文"), (error) => error.status === 502);
  assert.equal(calls.length, 1);
  t.mock.restoreAll();
  let finish;
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { finish = resolve; }));
  const controller = new AbortController();
  const pending = readSection("正文", undefined, { signal: controller.signal });
  controller.abort();
  finish(Response.json({ token: "same-token", body: "迟到正文", lines: { from: 1, to: 1, total: 1, nextLine: null, truncated: false } }));
  await assert.rejects(pending, (error) => error.name === "AbortError");
});

test("普通长行按字节提前成段，不为凑200行下载到超限", async (t) => {
  const calls = serving(t, Array(1000).fill("x".repeat(9000)).join("\n"), { chunk: 100 });
  const record = await readSection("长行日志", undefined, { markdown: false });
  assert.equal(calls.length, 1);
  assert.equal(record.lines.to, 100);
  assert.equal(record.lines.nextLine, 101);
});

test("长HTML表内的围栏字面量不改变结构，pipe表的表头不被200行边界截断", async (t) => {
  const html = ["<table>", ...Array(210).fill("<tr><td>表格正文</td></tr>"), "```", ...Array(50).fill("<tr><td>继续表格</td></tr>"), "</table>", "", ...Array(300).fill("后续正文")].join("\n");
  const calls = serving(t, html);
  const first = await readSection("长HTML表", "README.md");
  assert.equal(first.lines.to, 264);
  assert.ok(first.body.includes("```"));
  assert.equal(calls.length, 2);
  t.mock.restoreAll();
  const pipe = [...Array(199).fill("普通正文"), "| 名称 | 数值 |", "| --- | --- |", ...Array(280).fill("| 项目 | 42 |"), "", ...Array(300).fill("后续正文")].join("\n");
  serving(t, pipe, { chunk: 200 });
  const record = await readSection("长pipe表", "README.md");
  assert.equal(record.lines.to, 482);
  assert.ok(record.body.includes("| --- | --- |"));
  assert.equal(record.body.split("| 项目 | 42 |").length - 1, 280);
});

test("页缓存与相邻页记录有界，历史耗尽仍可按源序返回上一段", async () => {
  const cache = new ReaderPageCache();
  const history = [];
  let previous;
  for (let index = 0; index < 300; index++) {
    const record = { body: "x".repeat(300000), lines: { from: index * 200 + 1, to: index * 200 + 200, nextLine: index * 200 + 201 } };
    cache.put(record); rememberPage(history, previous, record); previous = record;
  }
  assert.ok(cache.items.size <= 8);
  assert.ok(cache.bytes <= 4 * 1024 * 1024);
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(cache.from(1), null);
  const original = { lines: { from: 40001, to: 40200, nextLine: 40201 } };
  let locates = 0;
  const reader = Object.assign(Object.create(PagedTextReader.prototype), {
    history: [], pages: new ReaderPageCache(), record: original, note: {}, isCurrent: () => true,
    controls() {}, onError: (error) => assert.fail(error.message),
    locate: async ({ around }) => { locates++; assert.equal(around, 39801); return { lines: { from: 39801 } }; },
    page: async (from, _signal, _initial, { to }) => { assert.equal(from, 39801); assert.equal(to, 40000); return { lines: { from, to, nextLine: 40001 } }; },
    display(record) { this.record = record; },
  });
  assert.equal(reader.canBack(), true);
  await reader.back();
  assert.equal(locates, 1);
  assert.equal(reader.record.lines.from, 39801);
});

test("读中原件变化使缓存失效，保留当前段并阻止继续混读", async () => {
  const original = { body: "已显示正文", lines: { from: 1, to: 200, nextLine: 201 } };
  const reader = Object.assign(Object.create(PagedTextReader.prototype), {
    pages: new ReaderPageCache(), record: original, note: {}, isCurrent: () => true,
    controls() {}, onRead() {}, onError() {},
  });
  reader.pages.put(original);
  await reader.run(async () => { throw Object.assign(new Error("读中原件变化"), { status: 409, code: "TEXT_CHANGED" }); });
  assert.equal(reader.stale, true);
  assert.equal(reader.pages.items.size, 0);
  assert.equal(reader.record, original);
  await reader.run(async () => assert.fail("旧版本不得继续混读"));
});

test("同行代码中的表格、注释和锚点保持文字，普通正文按200行分页", async (t) => {
  serving(t, ['正文中使用 `<table>`、`<!--` 和 `<a id="伪锚点">`。', ...Array(1000).fill("普通正文")].join("\n"));
  const record = await readSection("行内代码", "README.md");
  assert.equal(record.lines.to, 200);
  const scanner = new SectionScanner({ anchor: "伪锚点" });
  scanner.append('文字 ``<a id="伪锚点">`<table>`` 继续。');
  assert.equal(scanner.targetLine, undefined);
  assert.equal(scanner.tableDepth, 0);
  scanner.append('<a id="伪锚点"></a>');
  assert.equal(scanner.targetLine, 2);
  const unmatched = new SectionScanner();
  unmatched.append('未闭合的 ` 保持文字。');
  unmatched.append('<table>');
  assert.equal(unmatched.tableDepth, 1);
  const adjacent = new SectionScanner({ anchor: "目标" });
  adjacent.append('<ta`片段`ble>');
  adjacent.append('<a`片段` id="目标">');
  adjacent.append('`代码前缀` ```');
  assert.equal(adjacent.tableDepth, 0);
  assert.equal(adjacent.targetLine, undefined);
  assert.equal(adjacent.fence, null);
});

test("超长空白和未闭合HTML片段在线性预算内扫描，密集反引号明确拒绝", () => {
  const scanner = new SectionScanner();
  scanner.append(" ".repeat(1024 * 1024) + "普通文字");
  scanner.append("<table ".repeat(20000));
  scanner.append('<a id="'.repeat(20000));
  assert.equal(scanner.tableDepth, 0);
  assert.throws(() => new SectionScanner().append("`x".repeat(500000)), (error) => error.code === "TEXT_BLOCK_TOO_LARGE");
});

test("管道表分隔仅接受两个以上有效列，外侧管道可选且相邻分隔无效", () => {
  for (const delimiter of ["| --- | :---: |", " --- | --- ", "|---|---", "---|---|"]) {
    const scanner = new SectionScanner();
    scanner.append("| 名称 | 数值 |"); scanner.append(delimiter);
    assert.equal(scanner.pipe, true, delimiter);
  }
  for (const delimiter of ["| --- |", "---", "---||---", "|---||---|", "|---| |---|"]) {
    const scanner = new SectionScanner();
    scanner.append("| 名称 | 数值 |"); scanner.append(delimiter);
    assert.equal(scanner.pipe, false, delimiter);
  }
});

test("锚点仅匹配首个独立且带引号的id属性，不匹配data-id或其他属性值", () => {
  for (const line of [
    '<a data-id="目标"></a>', '<a title=\'id="目标"\'></a>',
    '<a id="别处" id="目标"></a>', '<a id=目标></a>', '<a-name id="目标"></a>',
  ]) {
    const scanner = new SectionScanner({ anchor: "目标" });
    scanner.append(line);
    assert.equal(scanner.targetLine, undefined, line);
  }
  const scanner = new SectionScanner({ anchor: "目标" });
  scanner.append('<A data-id="别处" title=\'id="伪"\' ID = "目标"></A>');
  assert.equal(scanner.targetLine, 1);
  const ordinary = new SectionScanner();
  ordinary.append('<table-name>保持普通标签</table-name>');
  assert.equal(ordinary.tableDepth, 0);
});
