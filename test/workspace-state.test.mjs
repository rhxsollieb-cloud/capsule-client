import assert from "node:assert/strict";
import test from "node:test";
import { Workspace } from "../web/workspace.mjs";

test("旧目录晚到响应不能替换当前cap的文件分页与显示提交", async (t) => {
  const responses = new Map();
  t.mock.method(globalThis, "fetch", (_url, request) => {
    const { name } = JSON.parse(request.body);
    return new Promise((resolve) => responses.set(name, resolve));
  });
  const rendered = [];
  const workspace = Object.create(Workspace.prototype);
  Object.assign(workspace, {
    cap: { name: "旧资料包", kind: "files", commit: "old" },
    selection: 1,
    viewRequest: 0,
    mode: "files",
    inspector: { context() {} },
    renderFiles() { rendered.push(this.filePage); },
    showError(error) { throw error; },
  });
  const previous = workspace.load({ background: true });
  workspace.cap = { name: "新资料包", kind: "files", commit: "new" };
  workspace.selection++;
  const current = workspace.load({ background: true });
  const page = { items: [{ path: "当前.md", size: 20 }], total: 1, nextOffset: null };
  responses.get("新资料包")(Response.json(page));
  await current;
  responses.get("旧资料包")(Response.json({ items: [{ path: "过期.md", size: 10 }] }));
  await previous;
  assert.deepEqual(workspace.filePage, page);
  assert.equal(workspace.displayedCommit, "new");
  assert.deepEqual(rendered, [page]);
});
