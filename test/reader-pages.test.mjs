import assert from "node:assert/strict";
import test from "node:test";
import { sectionEnd, readSection } from "../web/reader-pages.mjs";
import { TextEditor } from "../web/editor.mjs";

test("分页边界完整保留HTML表格和fenced code，不切开图片段落", () => {
  for (const [open, close] of [["<table>", "</table>"], ["```text", "```"]]) {
    const body = [open, ...Array(260).fill("内容行"), close, "", "![配图](assets/example.png)", "", "余下正文"].join("\n");
    assert.equal(sectionEnd(body), 263);
  }
  assert.equal(sectionEnd("# 标题\n\n正文\n\n", { complete: true }), 5);
  assert.equal(sectionEnd(Array(1000).fill("![连续配图](assets/image.png)").join("\n")), 200);
});

test("读取长块按nextLine续取，同段拒绝混入不同token", async (t) => {
  const body = ["```text", ...Array(260).fill("代码行"), "```", "", "之后"].join("\n");
  const lines = body.split("\n");
  let requests = 0;
  let changed = false;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const { from, limit } = JSON.parse(init.body); requests++;
    const to = Math.min(lines.length, from - 1 + limit);
    return Response.json({ token: changed && from > 1 ? "new" : "same", body: lines.slice(from - 1, to).join("\n"),
      lines: { from, to, total: lines.length, nextLine: to < lines.length ? to + 1 : null, truncated: to < lines.length || from > 1 } });
  });
  const record = await readSection("大书", "README.md", { token: "same" });
  assert.equal(requests, 2);
  assert.equal(record.body, body);
  assert.equal(record.lines.nextLine, null);
  changed = true;
  await assert.rejects(readSection("大书", "README.md", { token: "same" }), /不会拼接不同版本/);
});

test("全文编辑入口拒绝半本片段，不创建草稿或获取编辑占用", () => {
  const editor = new TextEditor({ createLease: () => ({ release() { assert.fail("不应触及编辑占用"); } }) });
  assert.throws(() => editor.open(null, { name: "大书" }, "README.md", {
    body: "只是一段", lines: { from: 201, to: 400, total: 1000, nextLine: 401, truncated: true },
  }), /分页正文不能作为完整文件/);
  assert.equal(editor.drafts.size, 0);
});
