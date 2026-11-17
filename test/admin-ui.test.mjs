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

test("管理凭据只在签发结果临时展示，关闭管理窗口清除token", async (t) => {
  const identity = { principal: { id: "admin", name: "管理员", role: "admin" }, permissions: { manage: true, create: true, readOnly: false } };
  const { admin, calls } = fixture(t, (input) => {
    if (input.action === "me") return identity;
    if (input.action === "users") return { items: [{ id: "employee", name: "员工", role: "viewer", enabled: true, revision: 1 }], total: 1, nextOffset: null };
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

test("只读身份只展示自身信息，管理页无授权不能展开", async (t) => {
  const { admin, calls } = fixture(t, () => ({ principal: { id: "reader", name: "只读员工", role: "viewer" }, permissions: { manage: false, create: false, readOnly: true } }));
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
