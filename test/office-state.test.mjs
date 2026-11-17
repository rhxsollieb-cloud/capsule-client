import test from "node:test";
import assert from "node:assert/strict";
import { OfficeState } from "../web/office-state.mjs";
import { OfficeView } from "../web/office.mjs";
import { testLease } from "./leaseFixture.mjs";

test("编辑器已收集变化不等于cap保存，只有对应回调确认才清除脏状态", () => {
  const state = new OfficeState({ token: "old" });
  state.changed(true);
  state.changed(false);
  assert.equal(state.hasDirty(), true);
  assert.equal(state.beginSave(), true);
  state.receive({ status: "saving", saveVersion: 0 });
  assert.equal(state.hasDirty(), true);
  state.receive({ status: "saved", saveVersion: 1, result: { token: "new" } });
  assert.equal(state.hasDirty(), false);
  assert.equal(state.cap.token, "new");
});

test("保存期间继续输入不会被旧回调清除，外部版本只标记不替换会话基线", () => {
  const state = new OfficeState({ token: "old" });
  state.changed(true); state.changed(false); state.beginSave();
  state.changed(true); state.changed(false);
  state.markRemote({ token: "external" });
  state.receive({ status: "saved", saveVersion: 1, result: { token: "saved" } });
  assert.equal(state.dirty, true);
  assert.equal(state.remote, true);
  assert.equal(state.cap.token, "saved");
  state.markRemote({ token: "saved" });
  assert.equal(state.remote, false);
});

test("保存冲突及无新原件响应不会把未保存内容标成成功", () => {
  const state = new OfficeState({ token: "old" });
  state.changed(true); state.changed(false); state.beginSave();
  state.receive({ status: "open", saveVersion: 0, unchanged: true });
  assert.equal(state.dirty, true);
  state.beginSave();
  state.receive({ status: "conflict", saveVersion: 0, recoveryAvailable: true });
  assert.equal(state.hasDirty(), true);
  assert.equal(state.cap.token, "old");
});

test("恢复已有编辑房间时需确认cap保存，不能把DocServer缓存当成干净原件", () => {
  const state = new OfficeState({ token: "original" });
  state.receive({ resumed: true, status: "open", saveVersion: 0 });
  assert.equal(state.hasDirty(), true);
  state.beginSave();
  state.receive({ status: "saved", saveVersion: 1, unchanged: true, result: { token: "original" } });
  assert.equal(state.hasDirty(), false);
});

test("未知保存响应保留原generation与pending，迟到确认不会抹掉其后输入", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "保存命令响应未知", code: "OFFICE_SAVE_PENDING" }, { status: 503 }));
  const view = Object.create(OfficeView.prototype);
  Object.assign(view, {
    state: new OfficeState({ token: "original" }), session: { id: "test-office-session" },
    lease: testLease(),
    active: () => true, controls() {}, message() {}, onError() {},
    async poll() {
      this.state.changed(true); this.state.changed(false);
      this.state.receive({ status: "saving", saveVersion: 0 });
    },
  });
  view.state.changed(true); view.state.changed(false);
  assert.equal(await view.savePending(), false);
  assert.equal(view.state.saving, true);
  assert.equal(view.state.pending.generation, 1);
  view.state.receive({ status: "saved", saveVersion: 1, result: { token: "confirmed" } });
  assert.equal(view.state.dirty, true);
  assert.equal(view.state.cap.token, "confirmed");
});
