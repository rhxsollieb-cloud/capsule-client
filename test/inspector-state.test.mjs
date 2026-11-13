import assert from "node:assert/strict";
import test from "node:test";
import { Inspector } from "../web/inspector.mjs";

test("属性保存提供进行中状态，不能重复提交且继续输入保留草稿", async (t) => {
  let release;
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    return new Promise((resolve) => { release = resolve; });
  });
  const draft = { value: "待保存说明", original: "原始说明", dirty: true, baseToken: "old" };
  const inspector = Object.assign(Object.create(Inspector.prototype), {
    current: { name: "资料" }, draft, saveButton: {}, note: {},
    onSaved() {}, onError(error) { throw error; },
  });
  const saving = inspector.save();
  assert.equal(draft.saving, true);
  await inspector.save();
  assert.equal(calls, 1);
  draft.value = "保存期间继续输入";
  release(Response.json({ name: "资料", token: "new" }));
  await saving;
  assert.equal(draft.saving, false);
  assert.equal(draft.dirty, true);
  assert.equal(draft.original, "待保存说明");
  assert.equal(draft.baseToken, "new");
});
