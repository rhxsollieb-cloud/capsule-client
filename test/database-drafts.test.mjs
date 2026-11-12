import assert from "node:assert/strict";
import test from "node:test";
import { createDraft, editCell, editableCell } from "../web/database-drafts.mjs";

test("表格编辑保留原记录和token，回改清除待提交行", () => {
  const record = { token: "read-token", commit: "read-commit", editable: true, schema: [{ name: "id", pk: 1 }, { name: "note", pk: 0 }], items: [{ id: 3, note: null }] };
  const draft = createDraft(record, 50);
  assert.equal(editableCell(draft, 0, "note"), true);
  assert.equal(editableCell(draft, 0, "id"), false);
  editCell(draft, 0, "note", "修改内容");
  assert.deepEqual([...draft.changes.values()], [{ operation: "update", key: { id: 3 }, values: { note: "修改内容" } }]);
  assert.equal(draft.record.token, "read-token");
  assert.equal(record.items[0].note, null);
  assert.equal(draft.offset, 50);
  editCell(draft, 0, "note", null);
  assert.equal(draft.dirty, false);
  assert.equal(draft.changes.size, 0);
});

test("主键缺失或NULL及数据库生成列不能通过网格编辑", () => {
  const record = { editable: true, schema: [{ name: "id", pk: 1 }, { name: "computed", hidden: 2 }], items: [{ id: null, computed: 9 }] };
  assert.equal(editableCell(createDraft(record), 0, "computed"), false);
  record.schema[1].hidden = 0;
  assert.equal(editableCell(createDraft(record), 0, "computed"), false);
});

test("共享草稿保存期间重新打开也不能修改待提交快照", () => {
  const draft = createDraft({ editable: true, schema: [{ name: "id", pk: 1 }, { name: "note" }], items: [{ id: 1, note: "原内容" }] });
  editCell(draft, 0, "note", "已发送内容");
  draft.saving = true;
  assert.equal(editableCell(draft, 0, "note"), false);
  editCell(draft, 0, "note", "晚输入内容");
  assert.equal(draft.rows[0].note, "已发送内容");
  assert.equal(draft.changes.get(0).values.note, "已发送内容");
});
