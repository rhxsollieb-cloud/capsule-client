import test from "node:test";
import assert from "node:assert/strict";
import { LibraryManagement } from "../web/library-management.mjs";
import { leaseReply } from "./leaseFixture.mjs";

const settled = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, respond, callbacks = {}) {
  const previous = globalThis.document;
  const element = (tag) => ({
    tag, children: [], listeners: {}, attributes: {}, value: "", disabled: false,
    get isConnected() { return this.root || Boolean(this.parent?.isConnected); },
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
    replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
    dispatch(type) { return Promise.all((this.listeners[type] || []).map((listener) => listener({ preventDefault() {} }))); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; },
  });
  globalThis.document = { createElement: element };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const dialog = element("dialog");
  dialog.root = true;
  dialog.close = () => { dialog.open = false; };
  const views = [];
  const dialogs = {
    element: dialog,
    form() {
      dialog.close();
      const view = Object.fromEntries(["form", "fields", "error", "actions"].map((name) => [name, element(name === "form" ? "form" : "div")]));
      view.form.append(view.fields, view.error, view.actions);
      dialog.replaceChildren(view.form);
      views.push(view);
      return view;
    },
    show() { dialog.open = true; },
  };
  const calls = [];
  t.mock.method(globalThis, "fetch", (_url, options) => {
    const input = JSON.parse(options.body);
    if (input.action.startsWith("lease-")) return Promise.resolve(Response.json(leaseReply(input)));
    calls.push(input);
    return Promise.resolve(respond(input)).then((value) => value instanceof Response ? value : Response.json(value));
  });
  const pending = [];
  const unlinked = [];
  const manager = new LibraryManagement({ dialogs, draftState: () => ({}), onPending: (event) => pending.push(event), onUnlinked: (item) => unlinked.push(item), ...callbacks });
  return { manager, views, dialog, calls, pending, unlinked };
}

function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const result = find(child, predicate);
    if (result) return result;
  }
}

const preview = (name, extra = {}) => ({ name, token: `${name}-version`, mountsToken: `${name}-mounts`, mounts: [], blockedBy: [], blockedReasons: [], ...extra });
const confirmation = (view) => find(view.fields, (element) => element.tag === "input");
const submitButton = (view) => find(view.actions, (element) => element.type === "submit");

test("清除预览有阻止原因或子挂载时不提供提交入口", async (t) => {
  const { manager, views, calls } = fixture(t, () => preview("资料包", { blockedBy: [{ name: "子cap", path: "/资料包/子cap" }], blockedReasons: ["Office会话仍在编辑"] }));
  await manager.open("delete", { name: "资料包" });
  assert.equal(submitButton(views[0]), undefined);
  assert.equal(confirmation(views[0]), undefined);
  assert.ok(find(views[0].fields, (element) => element.textContent?.includes("Office会话仍在编辑")));
  assert.ok(find(views[0].fields, (element) => element.textContent?.includes("/资料包/子cap")));
  assert.deepEqual(calls.map((call) => call.action), ["removal"]);
});

test("清除严格确认完整名称，提交后输入变化也不能重复发送", async (t) => {
  let finish;
  const result = { id: "delete-1", name: "资料包", type: "delete", status: "pending" };
  const { manager, views, calls, pending } = fixture(t, (input) => input.action === "removal" ? preview(input.name) : new Promise((resolve) => { finish = resolve; }));
  await manager.open("delete", { name: "资料包" });
  const view = views[0], input = confirmation(view), submit = submitButton(view);
  for (const value of ["资料", "资料包 ", " 资料包"]) {
    input.value = value;
    await input.dispatch("input");
    await view.form.dispatch("submit");
    assert.equal(submit.disabled, true);
  }
  assert.equal(calls.length, 1);
  input.value = "资料包";
  await input.dispatch("input");
  assert.equal(submit.disabled, false);
  const saving = view.form.dispatch("submit");
  await settled();
  input.value = "资料";
  await input.dispatch("input");
  input.value = "资料包";
  await input.dispatch("input");
  const duplicate = view.form.dispatch("submit");
  assert.equal(submit.disabled, true);
  assert.deepEqual(calls[1], { action: "delete", name: "资料包", token: "资料包-version", mountsToken: "资料包-mounts" });
  assert.equal(calls.length, 2);
  finish(result);
  await Promise.all([saving, duplicate]);
  assert.deepEqual(pending, [result]);
});

test("断链仅提交显示时的位置与子树token，不触碰草稿", async (t) => {
  const drafts = new Map([["资料包\0README.md", { body: "未保存正文", dirty: true }]]);
  const item = { name: "资料包", path: "/主题/资料包" };
  const { manager, views, calls, pending, unlinked } = fixture(t, (input) => input.action === "position"
    ? { token: "position-version", items: [item] } : { path: item.path, removed: true },
  { draftState: () => { throw new Error("断链不应检查或清理实体草稿"); } });
  await manager.open("unlink", item);
  await views[0].form.dispatch("submit");
  assert.deepEqual(calls, [{ action: "position", path: item.path }, { action: "unmount", path: item.path, token: "position-version" }]);
  assert.deepEqual(unlinked, [item]);
  assert.equal(pending.length, 0);
  assert.equal(drafts.get("资料包\0README.md").body, "未保存正文");
});

test("晚到预览不替换后来对话框，晚到提交只回报原cap并保留新对话框", async (t) => {
  let firstPreview, firstDelete;
  const { manager, views, calls, dialog, pending } = fixture(t, (input) => {
    if (input.action === "removal" && input.name === "旧cap") return new Promise((resolve) => { firstPreview = resolve; });
    if (input.action === "delete") return new Promise((resolve) => { firstDelete = resolve; });
    return preview(input.name);
  });
  const oldOpening = manager.open("delete", { name: "旧cap" });
  await manager.open("delete", { name: "当前cap" });
  const current = views[1];
  firstPreview(preview("旧cap"));
  await oldOpening;
  assert.equal(submitButton(views[0]), undefined);
  assert.equal(current.form.isConnected, true);
  confirmation(current).value = "当前cap";
  await confirmation(current).dispatch("input");
  const submitting = current.form.dispatch("submit");
  await settled();
  await manager.open("delete", { name: "后来cap" });
  const result = { id: "current-delete", name: "当前cap", type: "delete", status: "pending" };
  firstDelete(result);
  await submitting;
  assert.deepEqual(pending, [result]);
  assert.equal(dialog.open, true);
  assert.equal(views[2].form.isConnected, true);
  assert.equal(calls.filter((call) => call.action === "delete")[0].name, "当前cap");
});

test("未知清除结果保留事件回执且不重新启用提交", async (t) => {
  const { manager, views, calls, pending } = fixture(t, (input) => input.action === "removal" ? preview(input.name)
    : Response.json({ error: "结果尚未确认", eventId: "uncertain-delete" }, { status: 503 }));
  await manager.open("delete", { name: "资料包" });
  const view = views[0], input = confirmation(view);
  input.value = "资料包";
  await input.dispatch("input");
  await view.form.dispatch("submit");
  assert.match(view.error.textContent, /uncertain-delete/);
  input.value = "资料包";
  await input.dispatch("input");
  await view.form.dispatch("submit");
  assert.equal(submitButton(view).disabled, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(pending, [{ id: "uncertain-delete", name: "资料包", type: "delete", status: "pending" }]);
});
