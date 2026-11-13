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

test("文字替换读完整范围并用原token，替换文字按字面处理", async () => {
  const first = Array.from({ length: 10000 }, (_, i) => `第${i}行`).join("\n");
  const api = textApi([
    { token: "original", body: first, lines: { nextLine: 10001 } },
    { token: "original", body: "目标\n尾声", lines: { nextLine: null } },
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
  const stale = textApi([{ token: "original", body: "旧", lines: { nextLine: 2 } }, { token: "changed", body: "目标", lines: { nextLine: null } }]);
  await assert.rejects(editText(stale, { name: "正文", oldText: "目标", newText: "新", token: "original" }), (error) => error.status === 409);
  assert.equal(stale.writes.length, 0);
  for (const body of ["没有目标", "old old"]) {
    const api = textApi([{ token: "original", body, lines: { nextLine: null } }]);
    await assert.rejects(editText(api, { name: "正文", oldText: "old", newText: "new", token: "original" }), /未写入|多处/);
    assert.equal(api.writes.length, 0);
  }
  const explicit = textApi([{ token: "original", body: "old old", lines: { nextLine: null } }]);
  await editText(explicit, { name: "资料包", entry: "notes.txt", oldText: "old", newText: "$1", all: true, token: "original" });
  assert.equal(explicit.reads[0].operation, "read");
  assert.deepEqual(explicit.writes[0], { name: "资料包", entry: "notes.txt", body: "$1 $1", token: "original" });
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
