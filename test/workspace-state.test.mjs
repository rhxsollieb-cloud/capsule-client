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

test("Office后台发现新提交仅通知当前会话，不重建正在编辑的文档", async (t) => {
  const current = { name: "原件.docx", kind: "word", commit: "old", token: "old-token" };
  const updated = { ...current, commit: "new", token: "new-token" };
  t.mock.method(globalThis, "fetch", async () => Response.json(updated));
  const refreshed = [];
  const office = { refresh: (cap) => refreshed.push(cap) };
  const workspace = Object.create(Workspace.prototype);
  Object.assign(workspace, {
    cap: current, office, selection: 1,
    inspector: { show() {} }, navigation: { update() {} },
    chrome() {},
    load() { throw new Error("Office会话不能被后台刷新重建"); },
    onError(error) { throw error; },
  });
  await workspace.refresh(true);
  assert.equal(workspace.office, office);
  assert.deepEqual(refreshed, [updated]);
  assert.equal(workspace.cap.commit, "new");
});

test("Office离开前保存未确认时保留当前选择和编辑器", async () => {
  const workspace = Object.create(Workspace.prototype);
  const cap = { name: "原件.docx" };
  Object.assign(workspace, { cap, selection: 2, office: { prepareLeave: async () => false, destroy() { throw new Error("未保存的编辑器不能销毁"); } } });
  assert.equal(await workspace.select({ name: "另一个文件" }), false);
  assert.equal(workspace.selection, 2);
  assert.equal(workspace.cap, cap);
});
