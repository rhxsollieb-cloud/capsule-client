import assert from "node:assert/strict";
import test from "node:test";
import { TextEditor } from "../web/editor.mjs";
import { Inspector } from "../web/inspector.mjs";
import { saveErrorPresentation, saveErrorRecord } from "../web/save-errors.mjs";

const failures = [
  { code: "LOCK_BUSY", label: "内容处理中", text: "查询胶囊活动" },
  { code: "EVENT_BUSY", label: "已有待处理事件", text: "查询原事件" },
  { code: "WORKSPACE_BUSY", label: "工作区被占用", text: "服务端实例" },
  { code: "UNKNOWN_CONFLICT", label: "保存失败", text: "保存失败" },
  { code: undefined, label: "保存失败", text: "保存失败" },
  { code: "VERSION_CONFLICT", label: "版本冲突", text: "已有新版本" },
];

function stubDocument(t) {
  const previous = globalThis.document;
  const element = () => ({ children: [], style: {}, classList: { add() {} },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, cloneNode() { return element(); },
  });
  globalThis.document = { createElement: element };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  return element;
}

function errorResponse(failure) {
  return Response.json({ error: "原始诊断", ...(failure.code ? { code: failure.code } : {}), eventId: "existing-event" }, { status: 409 });
}

test("保存错误依据机器码区分处理忙、已有事件、工作区占用与版本冲突", () => {
  for (const failure of failures) {
    const value = saveErrorPresentation({ status: 409, code: failure.code, eventId: "existing-event", message: "版本冲突" });
    assert.equal(value.label, failure.label);
    assert.match(value.message, new RegExp(failure.text));
    assert.match(value.message, /草稿和原基线已保留/);
    assert.match(value.message, /existing-event/);
    assert.equal(value.state, failure.code === "VERSION_CONFLICT" ? "conflict" : "error");
    if (failure.code !== "VERSION_CONFLICT") assert.equal(value.message.includes("版本冲突"), false);
  }
  assert.equal(saveErrorPresentation({ code: "LOCK_BUSY" }, { remote: true }).state, "conflict");
  const unknown = saveErrorPresentation({ uncertain: true, eventId: "unknown-event" });
  assert.equal(unknown.label, "保存结果未确认");
  assert.match(unknown.message, /不要重复提交/);
  assert.match(unknown.message, /unknown-event/);
  assert.deepEqual(saveErrorRecord(Object.assign(new Error("连接未确认"), { status: 502, code: "RESULT_UNKNOWN", eventId: "unknown-event", uncertain: true })), {
    status: 502, code: "RESULT_UNKNOWN", eventId: "unknown-event", uncertain: true, message: "连接未确认",
  });
});

test("文本保存失败保留错误码和事件ID，不改变正文基线且标题/正文提示一致", async (t) => {
  const element = stubDocument(t);
  let response;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => { calls.push(JSON.parse(init.body)); return errorResponse(response); });
  for (const failure of failures) {
    response = failure;
    const cap = { name: "正文.txt", token: "old-token", commit: "old-commit" };
    const errors = [];
    const editor = new TextEditor({ onSaved() { assert.fail("失败不可保存成功"); }, onError: (error) => errors.push(error) });
    const key = editor.key(cap.name);
    const draft = { body: "未保存正文", original: "原正文", baseToken: cap.token, baseCommit: cap.commit, dirty: true };
    editor.drafts.set(key, draft);
    editor.current = { key, cap, remote: false, banner: element() };
    await editor.save(cap, undefined, draft);
    const controls = editor.controls(cap.name);
    assert.equal(controls.statusText, failure.label);
    assert.equal(controls.state, failure.code === "VERSION_CONFLICT" ? "conflict" : "error");
    assert.match(editor.current.banner.children[0].textContent, new RegExp(failure.text));
    assert.match(controls.detail, /existing-event/);
    assert.equal(draft.error.code, failure.code);
    assert.equal(draft.error.eventId, "existing-event");
    assert.equal(draft.baseToken, "old-token");
    assert.equal(draft.body, "未保存正文");
    assert.equal(draft.dirty, true);
    assert.equal(controls.canSave, true);
    assert.equal(errors.length, 1);
    assert.equal(calls.at(-1).token, "old-token");
  }
  assert.equal(calls.length, failures.length);
});

test("数据表保存错误经过finally及控件刷新仍保留，修改及原token不丢失", async (t) => {
  stubDocument(t);
  const { DatabaseView } = await import("../web/database.mjs");
  let response;
  t.mock.method(globalThis, "fetch", async () => errorResponse(response));
  for (const failure of failures) {
    response = failure;
    const record = { table: "notes", token: "old-token", commit: "old-commit", editable: true };
    const changes = new Map([[0, { operation: "update", key: { id: 1 }, values: { body: "未保存" } }]]);
    const draft = { record, changes, dirty: true, rows: [{ id: 1, body: "未保存" }] };
    const errors = [], activity = [];
    const view = Object.assign(Object.create(DatabaseView.prototype), {
      cap: { name: "记录" }, draft, record, note: {}, save: {}, discard: {}, execute: {},
      isCurrent: () => true, onError: (error) => errors.push(error), onDirty: () => activity.push(draft.dirty),
      onSaved() { assert.fail("失败不可保存成功"); }, drafts: new Map([["记录\0notes", draft]]),
    });
    await view.saveChanges();
    assert.match(view.note.textContent, new RegExp(failure.text));
    assert.match(view.note.textContent, /existing-event/);
    view.controls();
    assert.match(view.note.textContent, new RegExp(failure.text));
    assert.equal(draft.error.code, failure.code);
    assert.equal(draft.error.eventId, "existing-event");
    assert.equal(draft.record.token, "old-token");
    assert.equal(draft.changes.size, 1);
    assert.equal(draft.rows[0].body, "未保存");
    assert.equal(draft.dirty, true);
    assert.equal(draft.saving, false);
    assert.equal(view.save.disabled, false);
    assert.equal(errors.length, 1);
    assert.deepEqual(activity, [true]);
  }
});

test("属性说明保存保留同一草稿错误与事件，后续输入和活动心跳不会清除提示", async (t) => {
  let response;
  t.mock.method(globalThis, "fetch", async () => errorResponse(response));
  for (const failure of failures) {
    response = failure;
    const draft = { value: "未保存简述", original: "原简述", baseToken: "old-token", dirty: true };
    const errors = [], activity = [];
    const inspector = Object.assign(Object.create(Inspector.prototype), {
      current: { name: "图片.png", token: "old-token" }, draft, view: {}, element: { open: true },
      saveButton: {}, note: {}, activity: { setTarget: (target) => activity.push(target) },
      onSaved() { assert.fail("失败不可保存成功"); }, onError: (error) => errors.push(error),
    });
    await inspector.save();
    assert.match(inspector.note.textContent, new RegExp(failure.text));
    assert.match(inspector.note.textContent, /existing-event/);
    draft.value = "继续输入";
    inspector.changed();
    assert.match(inspector.note.textContent, new RegExp(failure.text));
    assert.equal(draft.error.code, failure.code);
    assert.equal(draft.error.eventId, "existing-event");
    assert.equal(draft.baseToken, "old-token");
    assert.equal(draft.value, "继续输入");
    assert.equal(draft.dirty, true);
    assert.equal(draft.saving, false);
    assert.equal(inspector.saveButton.disabled, false);
    assert.deepEqual(activity.at(-1), { name: "图片.png", scope: "details", dirty: true });
    assert.equal(errors.length, 1);
  }
});
