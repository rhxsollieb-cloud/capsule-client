import test from "node:test";
import assert from "node:assert/strict";
import { TextEditor } from "../web/editor.mjs";
import { OfficeState } from "../web/office-state.mjs";
import { OfficeView } from "../web/office.mjs";

function textFixture(onDirty = () => {}) {
  const cap = { name: "notes.md", token: "old-token", commit: "old-commit" };
  const editor = new TextEditor({ onSaved() {}, onError() {}, onDirty });
  const key = editor.key(cap.name);
  const draft = { body: "edited", original: "original", baseToken: cap.token, baseCommit: cap.commit, dirty: true };
  editor.drafts.set(key, draft);
  editor.current = { key, cap, markdown: true, mode: "edit", switchMode() {} };
  editor.renderNotice = () => {};
  return { editor, draft, cap };
}

test("单行标题控件仅操作当前文本，普通草稿通过菜单放弃", () => {
  const { editor, cap } = textFixture();
  let saves = 0;
  let toggles = 0;
  let discards = 0;
  editor.save = () => { saves++; };
  editor.discard = () => { discards++; };
  editor.current.switchMode = () => { toggles++; };
  const controls = editor.controls(cap.name);
  assert.equal(controls.state, "dirty");
  assert.equal(controls.canSave, true);
  assert.equal(controls.moreItems[0].label, "放弃草稿并重载");
  controls.save();
  controls.toggleMode();
  assert.equal(saves, 1);
  assert.equal(toggles, 1);
  assert.equal(discards, 0);
  editor.current = { key: "another" };
  controls.save();
  controls.toggleMode();
  assert.equal(saves, 1);
  assert.equal(toggles, 1);
  assert.equal(editor.controls(cap.name), null);
});

test("标题保存沿用原 token，保存期间继续输入并在完成时刷新控件状态", async (t) => {
  let accept;
  let request;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    request = JSON.parse(options.body);
    return new Promise((resolve) => { accept = resolve; });
  });
  const states = [];
  const { editor, draft, cap } = textFixture(() => states.push(editor.controls(cap.name).state));
  const saving = editor.controls(cap.name).save();
  assert.equal(request.token, "old-token");
  assert.equal(request.body, "edited");
  assert.equal(editor.controls(cap.name).canSave, false);
  draft.body = "edited while saving";
  accept(Response.json({ ...cap, token: "new-token", commit: "new-commit" }));
  await saving;
  assert.equal(draft.original, "edited");
  assert.equal(draft.body, "edited while saving");
  assert.equal(draft.baseToken, "new-token");
  assert.equal(draft.dirty, true);
  assert.equal(draft.saving, false);
  assert.deepEqual(states, ["saving", "dirty"]);
});

test("标题保存冲突保留文本和基线，仍可查找放弃草稿入口", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "冲突", code: "VERSION_CONFLICT" }, { status: 409 }));
  const { editor, draft, cap } = textFixture();
  await editor.controls(cap.name).save();
  const controls = editor.controls(cap.name);
  assert.equal(controls.state, "conflict");
  assert.equal(draft.baseToken, "old-token");
  assert.equal(draft.body, "edited");
  assert.equal(draft.dirty, true);
  assert.equal(controls.moreItems.length, 1);
});

test("Office 标题控件遵从收集、保存确认和冲突恢复状态", () => {
  const view = Object.create(OfficeView.prototype);
  Object.assign(view, { state: new OfficeState({ commit: "base", token: "original" }), ready: true });
  assert.equal(view.controlsInfo().state, "clean");
  view.state.changed(true);
  assert.equal(view.controlsInfo().state, "dirty");
  view.collecting = true;
  assert.equal(view.controlsInfo().state, "saving");
  assert.equal(view.controlsInfo().canSave, false);
  view.collecting = false;
  view.state.changed(false);
  view.state.beginSave();
  assert.equal(view.controlsInfo().canSave, false);
  view.state.receive({ status: "conflict", saveVersion: 0, recoveryAvailable: true });
  const conflict = view.controlsInfo();
  assert.equal(conflict.state, "conflict");
  assert.equal(conflict.canSave, false);
  assert.equal(conflict.moreItems[1].label, "下载恢复原件");
  assert.equal(view.state.hasDirty(), true);
});
