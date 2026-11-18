import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { dispatch } from "../src/cli.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { performAction } from "../src/ui/actions.mjs";
import { editText } from "../src/operations/content.mjs";

function textApi(pages) {
  const writes = [];
  const reads = [];
  return {
    writes, reads,
    path: (name, operation, query) => ({ name, operation, query }),
    json: async (path, method = "GET", body) => {
      if (method !== "GET") { writes.push({ path, method, body }); return { name: path.name, token: "saved", commit: "new" }; }
      reads.push(path);
      return pages[reads.length - 1];
    },
    putText: async (name, entry, body, token) => { writes.push({ name, entry, body, token }); return { name, token: "saved" }; },
  };
}

function textPage(body, { token = "original", commit = "first", from = 1, total = from + body.split("\n").length - 1 } = {}) {
  const to = from + body.split("\n").length - 1;
  return { token, commit, source: { type: "content", entry: "README.md" }, body,
    lines: { from, to, total, nextLine: to < total ? to + 1 : null, truncated: from > 1 || to < total } };
}

test("文字替换读完整范围并用原token，替换文字按字面处理", async () => {
  const first = Array.from({ length: 10000 }, (_, i) => `第${i}行`).join("\n");
  const api = textApi([
    textPage(first, { total: 10002 }),
    textPage("目标\n尾声", { from: 10001 }),
  ]);
  const result = await dispatch(parseArguments(["edit", "手册.md", "--old-text", "目标", "--new-text", "$&", "--token", "original"]), api);
  assert.equal(result.replacements, 1);
  assert.equal(api.reads[1].query.from, 10001);
  assert.equal(api.reads[0].operation, "details");
  assert.equal(api.writes[0].method, "PUT");
  assert.equal(api.writes[0].body.token, "original");
  assert.equal(api.writes[0].body.body, first + "\n$&\n尾声");
});

test("跨页冲突、零或多匹配均不写入，显式entry使用原件文本接口", async () => {
  const stale = textApi([textPage("旧", { total: 2 }), textPage("目标", { token: "changed", from: 2 })]);
  await assert.rejects(editText(stale, { name: "正文", oldText: "目标", newText: "新", token: "original" }), (error) => error.status === 409);
  assert.equal(stale.writes.length, 0);
  for (const body of ["没有目标", "old old"]) {
    const api = textApi([textPage(body)]);
    await assert.rejects(editText(api, { name: "正文", oldText: "old", newText: "new", token: "original" }), /未写入|多处/);
    assert.equal(api.writes.length, 0);
  }
  const explicit = textApi([textPage("old old")]);
  await editText(explicit, { name: "资料包", entry: "notes.txt", oldText: "old", newText: "$1", all: true, token: "original" });
  assert.equal(explicit.reads[0].operation, "read");
  assert.deepEqual(explicit.writes[0], { name: "资料包", entry: "notes.txt", body: "$1 $1", token: "original" });
});

test("edit预演返回当前版本、完整范围和匹配数，同一token可携简述一次应用", async () => {
  const args = ["edit", "手册.md", "--old-text", "旧", "--new-text", "新", "--description", "同步简介"];
  const api = textApi([textPage("旧"), textPage("旧")]);
  const preview = await dispatch(parseArguments([...args, "--dry-run"]), api);
  assert.deepEqual(preview, {
    dryRun: true, name: "手册.md", source: { type: "content", entry: "README.md" },
    token: "original", commit: "first", lines: { from: 1, to: 1, total: 1, nextLine: null, truncated: false }, matches: 1, canApply: true,
  });
  assert.equal(api.writes.length, 0);
  await dispatch(parseArguments([...args, "--token", preview.token]), api);
  assert.deepEqual(api.writes.map((call) => call.body), [{ token: "original", body: "新", description: "同步简介" }]);
});

test("edit预演区分零匹配、多匹配和JSON写入预算，均无写入", async () => {
  for (const [body, oldText, newText, all, blockedBy, matches] of [
    ["没有目标", "old", "new", false, "NO_MATCH", 0],
    ["old old", "old", "new", false, "MULTIPLE_MATCHES", 2],
    ["a".repeat(550000), "a", "\t", true, "TEXT_TOO_LARGE", 550000],
  ]) {
    const api = textApi([textPage(body)]);
    const result = await editText(api, { name: "正文", oldText, newText, all, dryRun: true });
    assert.equal(result.canApply, false);
    assert.equal(result.blockedBy, blockedBy);
    assert.equal(result.matches, matches);
    assert.equal(api.writes.length, 0);
  }
});

test("edit拒绝缺游标、跳页、重叠、总行数或提交不一致，均无写入", async () => {
  const first = textPage("旧", { total: 2 });
  const last = textPage("尾声", { from: 2 });
  const missingCursor = { ...first, lines: { ...first.lines } };
  delete missingCursor.lines.nextLine;
  for (const pages of [
    [missingCursor],
    [{ ...first, lines: { ...first.lines, nextLine: 3 } }],
    [first, textPage("尾声", { from: 1, total: 2 })],
    [first, textPage("尾声", { from: 2, total: 3 })],
    [first, { ...last, commit: "unexpected" }],
  ]) {
    const api = textApi(pages);
    await assert.rejects(editText(api, { name: "正文", oldText: "旧", newText: "新", token: "original" }),
      (error) => error.status === 502 && error.code === "INVALID_RESPONSE");
    assert.equal(api.writes.length, 0);
  }
});

test("CLI与BFF共用位置移动和组织服务，拒绝参数不访问后端", async () => {
  const calls = [];
  const api = new ApiClient({ serverUrl: "http://backend.invalid", token: "" }, async (url, init) => {
    calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
    return Response.json({ ok: true });
  });
  await dispatch(parseArguments(["move", "/父/正文.txt", "/新父/正文.txt", "--token", "tree"]), api);
  await performAction(api, { action: "move", path: "/父/正文.txt", to: "/新父/正文.txt", token: "tree" });
  assert.deepEqual(calls[0], calls[1]);
  await assert.rejects(performAction(api, { action: "move", path: "/父/../正文.txt", to: "/新父/正文.txt", token: "tree" }), (error) => error.status === 400);
  await performAction(api, { action: "where", name: "正文.txt", limit: 5 });
  assert.match(decodeURIComponent(calls[2].url), /正文.txt\/positions\?limit=5/);
  await performAction(api, { action: "organize-receipt", receipt: "latest", limit: 1 });
  assert.match(calls[3].url, /organize\/receipts\/latest\?limit=1/);
  await assert.rejects(performAction(api, { action: "organize", plan: {}, offset: 1 }), (error) => error.status === 400);
  assert.equal(calls.length, 4);
});
