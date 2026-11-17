import assert from "node:assert/strict";
import test from "node:test";
import { Administration } from "../web/admin.mjs";

const settled = () => new Promise((resolve) => setImmediate(resolve));
function fixture(t, respond) {
  const previous = globalThis.document;
  function element(tag) {
    const value = {
      tag, children: [], listeners: {}, className: "", value: "", attributes: {},
      append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      setAttribute(key, content) { this.attributes[key] = content; },
      addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
      querySelectorAll(selector) {
        return this.children.flatMap((child) => [...(selector.split(/,\s*/).includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)]);
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      emit(type) { for (const listener of this.listeners[type] || []) listener({ target: this, preventDefault() {} }); },
      click() { if (!this.disabled) this.emit("click"); },
      showModal() { this.open = true; }, close() { this.open = false; this.emit("close"); },
    };
    value.classList = {
      add(name) { value.className += " " + name; },
      remove(name) { value.className = value.className.split(/\s+/).filter((item) => item !== name).join(" "); },
    };
    Object.defineProperty(value, "textContent", { get() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }, set(text) { this.text = String(text); this.children = []; } });
    return value;
  }
  globalThis.document = { createElement: element, body: element("body") };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const calls = [], identities = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const input = JSON.parse(init.body); calls.push(input);
    const result = await respond(input);
    return result instanceof Response ? result : Response.json(result);
  });
  const admin = new Administration({ onError: (error) => { throw error; }, onIdentity: (identity) => identities.push(identity) });
  return { admin, calls, identities };
}

test("管理员可创建有登录名密码的editor并更改现有用户名", async (t) => {
  const { admin, calls } = fixture(t, (input) => {
    if (input.action === "me") return { principal: { role: "admin" }, permissions: { manage: true } };
    if (input.action === "users") return { items: [{ id: "employee", name: "编辑同事", username: "editor01", role: "editor", enabled: true, revision: 7 }], total: 1, nextOffset: null };
    if (["user-create", "user-update"].includes(input.action)) return { user: { id: "employee" } };
    assert.fail(input.action);
  });
  await admin.open(); await admin.load("users");
  const create = admin.body.querySelectorAll("form").find((form) => form.textContent.includes("创建用户"));
  const fields = create.querySelectorAll("input");
  fields[0].value = "同事02"; fields[1].value = "editor02"; fields[2].value = "test-only-new-password";
  create.emit("submit"); await settled(); await settled();
  assert.deepEqual(calls.find((call) => call.action === "user-create"), { action: "user-create", name: "同事02", username: "editor02", password: "test-only-new-password", role: "editor" });
  assert.equal(fields[2].value, "");
  admin.body.querySelectorAll("button").find((control) => control.textContent === "编辑").click();
  const edit = admin.body.querySelectorAll("form").find((form) => form.textContent.includes("保存用户"));
  edit.querySelectorAll("input")[1].value = "renamed-editor";
  edit.emit("submit"); await settled(); await settled();
  const update = calls.find((call) => call.action === "user-update");
  assert.equal(update.username, "renamed-editor"); assert.equal(update.revision, 7);
  assert.equal(Object.hasOwn(update, "password"), false);
});

test("管理员设置全体非管理员三档权限，不出现个人授权且不冒用正文token", async (t) => {
  const { admin, calls } = fixture(t, (input) => {
    if (input.action === "me") return { principal: { role: "admin" }, permissions: { manage: true } };
    if (input.action === "cap-access" && input.permission === undefined) return { name: input.name, revision: 12, permission: "edit", protected: false };
    if (input.action === "cap-access") return { name: input.name, revision: 13, permission: input.permission, protected: false };
    assert.fail(input.action);
  });
  await admin.open(); await admin.load("grants");
  const lookup = admin.body.querySelectorAll("form")[0];
  lookup.querySelectorAll("input")[0].value = "管理员资料";
  lookup.emit("submit"); await settled();
  const protection = admin.body.querySelectorAll("form").find((form) => form.textContent.includes("保存 cap 权限"));
  const permissions = protection.querySelectorAll("select");
  assert.equal(permissions.length, 1);
  assert.deepEqual(permissions[0].children.map((option) => option.value), ["edit", "read", "none"]);
  assert.equal(protection.querySelectorAll("input").length, 0);
  permissions[0].value = "read";
  protection.emit("submit"); await settled(); await settled();
  assert.deepEqual(calls.find((call) => call.action === "cap-access" && call.permission), { action: "cap-access", name: "管理员资料", revision: 12, permission: "read" });
});

test("管理凭据只在签发结果临时展示，关闭管理窗口清除token", async (t) => {
  const identity = { principal: { id: "admin", name: "管理员", role: "admin" }, permissions: { manage: true, create: true, readOnly: false } };
  const { admin, calls } = fixture(t, (input) => {
    if (input.action === "me") return identity;
    if (input.action === "users") return { items: [{ id: "employee", name: "员工", role: "editor", enabled: true, revision: 1 }], total: 1, nextOffset: null };
    if (input.action === "credentials") return { items: [], total: 0, nextOffset: null };
    if (input.action === "credential-create") return { credential: { id: "credential", label: input.label }, token: "only-once-test-token" };
    assert.fail(input.action);
  });
  await admin.open(); await admin.load("users");
  admin.body.querySelectorAll("button").find((control) => control.textContent === "凭据").click();
  await settled();
  const form = admin.body.querySelectorAll("form").find((element) => element.textContent.includes("签发凭据"));
  form.querySelectorAll("input")[0].value = "工作电脑";
  form.emit("submit"); await settled(); await settled();
  assert.equal(calls.filter((call) => call.action === "credential-create").length, 1);
  assert.equal(admin.secretBox.querySelectorAll("input")[0].value, "only-once-test-token");
  assert.equal(JSON.stringify(admin.identity).includes("only-once-test-token"), false);
  assert.equal(admin.body.textContent.includes("only-once-test-token"), false);
  admin.element.close();
  assert.equal(admin.secretBox.children.length, 0);
  assert.equal(admin.element.children.length, 0);
});

test("普通员工可查询自身身份但不能展开管理页", async (t) => {
  const { admin, calls } = fixture(t, () => ({ principal: { id: "employee", name: "普通员工", role: "editor" }, permissions: { manage: false, create: true, readOnly: false } }));
  await admin.open();
  assert.equal(admin.tabs.querySelectorAll("button").length, 1);
  await admin.load("users");
  assert.deepEqual(calls.map((call) => call.action), ["me", "me"]);
  assert.match(admin.note.textContent, /没有管理权限/);
});

test("隔离恢复需使用原预演并输入完整确认名称，未知结果保留原恢复ID入口", async (t) => {
  const { admin, calls } = fixture(t, (input) => {
    if (input.action === "me") return { principal: { role: "admin" }, permissions: { manage: true } };
    if (input.action === "backups") return { items: [{ id: "backup", label: "备份", status: "ready" }], total: 1, nextOffset: null };
    if (input.action === "backup-restore-preview") return { previewId: "preview", restoreId: "recovery", checksum: "sha", confirmationName: "restore:backup", isolated: true };
    if (input.action === "backup-restore") return Response.json({ error: "结果未知，请查询", code: "RESULT_UNKNOWN", uncertain: true }, { status: 503 });
    if (input.action === "backup-receipt") return { restoreId: "recovery", isolated: true, status: "succeeded" };
    assert.fail(input.action);
  });
  await admin.open(); await admin.load("backups");
  admin.body.querySelectorAll("button").find((control) => control.textContent === "隔离恢复…").click(); await settled();
  const form = admin.body.querySelectorAll("form").find((element) => element.textContent.includes("恢复到隔离区"));
  form.querySelectorAll("input")[0].value = "wrong";
  form.emit("submit"); await settled();
  assert.equal(calls.some((call) => call.action === "backup-restore"), false);
  form.querySelectorAll("input")[0].value = "restore:backup";
  form.emit("submit"); await settled();
  assert.deepEqual(calls.find((call) => call.action === "backup-restore"), { action: "backup-restore", id: "backup", previewId: "preview", checksum: "sha", confirmationName: "restore:backup" });
  form.emit("submit"); await settled();
  assert.equal(calls.filter((call) => call.action === "backup-restore").length, 1);
  admin.body.querySelectorAll("button").filter((control) => control.textContent === "查询原恢复回执").at(-1).click(); await settled();
  assert.deepEqual(calls.at(-1), { action: "backup-receipt", restoreId: "recovery" });
  assert.equal(calls.filter((call) => call.action === "backup-restore").length, 1);
});
