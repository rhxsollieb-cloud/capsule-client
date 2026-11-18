import assert from "node:assert/strict";
import test from "node:test";
import { Workspace } from "../web/workspace.mjs";

function workspace() {
  const calls = [];
  const cap = { name: "阅读权限.md", kind: "markdown", commit: "same", token: "same", permissions: { read: true, edit: true } };
  const value = Object.assign(Object.create(Workspace.prototype), {
    cap, selection: 1, mode: "content", displayedCommit: cap.commit,
    editor: { updatePermissions() {} }, reader: { updatePermissions: (record) => calls.push(record.permissions) },
    inspector: { show() {} }, navigation: { update() {} }, chrome() {}, hasDirty: () => false,
    permissionsChanged() { calls.push(this.cap.permissions); },
    load() { assert.fail("相同版本权限更新不应重载正文"); },
  });
  return { value, calls };
}

test("同commit权限变化同步阅读器，不再保留旧编辑入口", async (t) => {
  const { value, calls } = workspace();
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...value.cap, permissions: { read: true, edit: false } }));
  await value.refresh();
  assert.deepEqual(calls, [{ read: true, edit: false }]);
});

test("后台认证失效或cap隐藏404会撤销阅读权限，迟到旧选择不覆盖当前权限", async (t) => {
  let respond;
  t.mock.method(globalThis, "fetch", async () => respond());
  for (const status of [401, 403, 404]) {
    const { value, calls } = workspace();
    respond = () => Response.json({ error: "无法访问" }, { status });
    await value.refresh();
    assert.deepEqual(calls, [{ read: false, edit: false, manage: false }]);
  }
  const { value, calls } = workspace();
  let finish;
  respond = () => new Promise((resolve) => { finish = resolve; });
  const pending = value.refresh();
  value.selection++;
  finish(Response.json({ error: "旧选择无法访问" }, { status: 404 }));
  await pending;
  assert.deepEqual(calls, []);
  assert.equal(value.cap.permissions.read, true);
});
