import assert from "node:assert/strict";
import test from "node:test";
import { setIdentity, canCreate, canEdit, canManage } from "../web/permissions.mjs";
import { TextEditor } from "../web/editor.mjs";
import { Inspector } from "../web/inspector.mjs";
import { OfficeView } from "../web/office.mjs";
import { TreeActions } from "../web/tree-actions.mjs";
import { SkillView } from "../web/skill.mjs";
import { Workspace } from "../web/workspace.mjs";

test("个人身份与cap响应权限控制只读账户、未知身份及不同cap", (t) => {
  t.after(() => setIdentity(undefined));
  setIdentity({ principal: { role: "viewer" }, permissions: { readOnly: true, create: false, manage: false } });
  assert.equal(canEdit({ permissions: { edit: true } }), false);
  assert.equal(canCreate(), false);
  assert.equal(canManage(), false);
  setIdentity(null);
  assert.equal(canEdit({ permissions: { edit: true } }), false);
  setIdentity({ principal: { role: "editor" }, permissions: { readOnly: false, create: true } });
  assert.equal(canCreate(), true);
  assert.equal(canEdit({ permissions: { edit: false } }), false);
  assert.equal(canEdit({ permissions: { edit: true } }), true);
  assert.equal(canManage(), false);
});

test("只读内容各写入口拒绝发送保存，保留原草稿并禁用节点删除/断链", async (t) => {
  t.after(() => setIdentity(undefined));
  setIdentity({ principal: { role: "viewer" }, permissions: { readOnly: true, create: false } });
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; throw new Error("只读不应发送保存"); });
  const cap = { name: "只读内容", kind: "text", permissions: { read: true, edit: false } };
  const draft = { body: "尚未保存", dirty: true, baseToken: "original" };
  const editor = new TextEditor({});
  editor.current = { key: editor.key(cap.name), cap };
  editor.drafts.set(editor.key(cap.name), draft);
  assert.equal(editor.controls(cap.name).save, undefined);
  await editor.save(cap, undefined, draft);
  const previous = globalThis.document;
  const element = () => ({ children: [], style: {}, classList: { add() {} }, append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); }, setAttribute() {}, cloneNode() { return element(); } });
  globalThis.document = { createElement: element };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const { DatabaseView } = await import("../web/database.mjs");
  await DatabaseView.prototype.saveChanges.call({ cap });
  await Inspector.prototype.save.call({ current: cap, draft });
  assert.equal(await OfficeView.prototype.save.call({ cap }), false);
  const items = TreeActions.prototype.items.call({ current: { ...cap, path: "/只读内容" } });
  assert.equal(items.find((item) => item.label?.startsWith("清除")).disabled, true);
  assert.equal(items.find((item) => item.label?.startsWith("断开")).disabled, true);
  assert.equal(calls, 0);
  assert.equal(draft.dirty, true);
  assert.equal(draft.baseToken, "original");
});

test("有创建能力的editor也不能通过Skill转换或Markdown详述入口修改只读cap", async (t) => {
  t.after(() => setIdentity(undefined));
  setIdentity({ principal: { role: "editor" }, permissions: { create: true, readOnly: false } });
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; throw new Error("只读cap不应发出变更"); });
  const skill = Object.assign(Object.create(SkillView.prototype), {
    cap: { name: "只读工具", kind: "code", permissions: { read: true, edit: false } },
    active: () => true, message: (value) => assert.match(value, /没有.*修改权限/),
  });
  await skill.perform("convert-skill");
  const markdown = { name: "只读手册.md", kind: "markdown", permissions: { read: true, edit: false } };
  const workspace = Object.assign(Object.create(Workspace.prototype), { cap: markdown,
    leaveOffice: () => assert.fail("只读入口不应进入编辑切换"),
  });
  await workspace.openDetails({ ...markdown, source: { type: "content", entry: "README.md" } });
  assert.equal(calls, 0);
});
