import test from "node:test";
import assert from "node:assert/strict";
import { DocumentHeader } from "../web/document-header.mjs";

function headerFixture(t) {
  const previous = { document: globalThis.document, window: globalThis.window };
  const document = {
    addEventListener() {}, removeEventListener() {},
    createElement: (tag) => element(tag),
    createElementNS: (_namespace, tag) => element(tag),
  };
  function element(tag) {
    const value = {
      tag, children: [], attributes: {}, listeners: {}, className: "", style: {}, isConnected: true,
      append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      setAttribute(name, content) { this.attributes[name] = content; },
      addEventListener(type, listener) { (this.listeners[type] ||= new Set()).add(listener); },
      removeEventListener(type, listener) { this.listeners[type]?.delete(listener); },
      querySelectorAll(selector) {
        if (selector === "audio, video") return [];
        return this.children.flatMap((child) => [
          ...(child.attributes.role?.startsWith("menuitem") ? [child] : []),
          ...child.querySelectorAll(selector),
        ]);
      },
      contains(target) { return target === this || this.children.some((child) => child.contains(target)); },
      getBoundingClientRect: () => ({ left: 10, bottom: 40, width: 220, height: 120 }),
      focus() { document.activeElement = this; },
      click() {
        if (this.disabled) return;
        const event = { target: this, preventDefault() {} };
        for (const listener of this.listeners.click || []) listener(event);
      },
      remove() { this.isConnected = false; },
    };
    value.classList = {
      contains: (name) => value.className.split(/\s+/).includes(name),
      toggle(name, force) {
        const names = new Set(value.className.split(/\s+/).filter(Boolean));
        const include = force ?? !names.has(name);
        if (include) names.add(name); else names.delete(name);
        value.className = [...names].join(" ");
        return include;
      },
      add(name) { this.toggle(name, true); },
      remove(name) { this.toggle(name, false); },
    };
    return value;
  }
  document.body = element("body");
  globalThis.document = document;
  globalThis.window = { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  return new DocumentHeader(element("header"), { onError: (error) => { throw error; } });
}

function model(name, controls = {}) {
  return { name, path: `/知识/${name}`, kind: "text", contextKey: name, cap: { name, kind: "text", commit: `${name}-commit` }, controls };
}

test("标题仅在需要时显示保存，保存中保留禁用状态", (t) => {
  const header = headerFixture(t);
  const save = () => {};
  header.update(model("notes.txt", { state: "clean", canSave: false, save }));
  assert.equal(header.save.classList.contains("hidden"), true);
  assert.equal(header.status.classList.contains("hidden"), true);

  header.update(model("notes.txt", { state: "dirty", statusText: "未保存", canSave: true, save }));
  assert.equal(header.save.classList.contains("hidden"), false);
  assert.equal(header.save.disabled, false);
  assert.equal(header.status.classList.contains("hidden"), false);
  assert.equal(header.status.attributes["aria-label"], "未保存");

  header.update(model("notes.txt", { state: "saving", canSave: false, save }));
  assert.equal(header.save.classList.contains("hidden"), false);
  assert.equal(header.save.disabled, true);
  assert.equal(header.status.textContent, "保存中");
});

test("上下文切换关闭菜单，已生成的菜单项仍绑定原 model", (t) => {
  const header = headerFixture(t);
  const original = model("first.txt");
  const shown = [];
  header.details = (value) => shown.push(value);
  header.update(original);
  header.menu.open();
  assert.equal(header.menu.opened, true);
  const oldDetails = header.menu.element.children.find((item) => item.children.some((child) => child.textContent === "位置与版本信息"));

  header.update({ ...original, controls: { state: "dirty" } });
  assert.equal(header.menu.opened, true);
  header.update(model("second.txt"));
  assert.equal(header.menu.opened, false);
  assert.equal(header.more.attributes["aria-expanded"], "false");
  assert.equal(header.menu.element.classList.contains("hidden"), true);
  oldDetails.click();
  assert.deepEqual(shown, [original]);
});

test("Cmd/Ctrl S只保存当前可保存内容，保留对话框和菜单快捷键", (t) => {
  const header = headerFixture(t);
  const saved = [];
  const key = (options = {}) => {
    const event = { key: "s", metaKey: true, target: { closest: () => null }, preventDefault() { this.defaultPrevented = true; }, ...options };
    header.shortcut(event);
    return event;
  };
  header.update(model("first.txt", { state: "dirty", canSave: true, save: () => saved.push("first") }));
  assert.equal(key().defaultPrevented, true);
  header.update(model("second.txt", { state: "dirty", canSave: true, save: () => saved.push("second") }));
  key({ metaKey: false, ctrlKey: true });
  for (const tag of ["dialog", "menu"]) {
    const event = key({ target: { closest: (selector) => selector.includes(tag === "menu" ? "[role=menu]" : "dialog") ? { tag } : null } });
    assert.equal(event.defaultPrevented, undefined);
  }
  key({ defaultPrevented: true });
  key({ metaKey: false, ctrlKey: false });
  header.update(model("second.txt", { state: "saving", canSave: false, save: () => saved.push("unexpected") }));
  key();
  assert.deepEqual(saved, ["first", "second"]);
});

test("Skill正常状态不显示常驻状态栏，CLI信息经现有更多菜单弹窗读取", (t) => {
  const header = headerFixture(t);
  const shown = [];
  header.showInformation = (title, values) => shown.push({ title, values });
  const information = { title: "独立 CLI 与本机状态", values: ["CLI：node scripts/cli.mjs", "CAPSULE_SKILL_STATE=/local/state"] };
  header.update(model("工具", { state: "clean", detail: "已注册 · 未启动", moreItems: [{ label: "CLI 与本机状态", icon: "info", information }] }));
  assert.equal(header.status.classList.contains("hidden"), true);
  assert.equal(header.save.classList.contains("hidden"), true);
  const info = header.items().find((item) => item?.label === "CLI 与本机状态");
  assert.ok(info);
  assert.deepEqual(shown, []);
  info.action();
  assert.deepEqual(shown, [information]);
  header.update(model("工具", { state: "warning", statusText: "有新版本", detail: "当前协作页面仍使用已注册提交" }));
  assert.equal(header.status.textContent, "有新版本");
  assert.equal(header.status.classList.contains("hidden"), false);
  assert.equal(header.save.classList.contains("hidden"), true);
});

test("标题活动常显且可按需查看，普通保存不被编辑会话或队列提示禁用", (t) => {
  const header = headerFixture(t);
  const shown = [];
  header.showInformation = (title, values) => shown.push({ title, values });
  const activity = { known: true, data: {
    name: "notes.txt", editors: [{ scope: "content", dirty: true, count: 2 }], editorCount: 2,
    events: [{ id: "event-1", type: "revert", status: "running" }], eventCount: 1, eventsTruncated: false,
    office: { active: false, saving: false }, ttlSeconds: 45,
  } };
  header.update({ ...model("notes.txt", { state: "dirty", canSave: true, save() {} }), activity });
  assert.equal(header.activity.element.classList.contains("hidden"), false);
  assert.match(header.activity.element.textContent, /另有 2 个编辑会话/);
  assert.match(header.activity.element.textContent, /待保存/);
  assert.match(header.activity.element.textContent, /处理中/);
  assert.equal(header.save.disabled, false);
  header.activity.element.click();
  assert.equal(shown[0].title, "胶囊活动");
  assert.ok(shown[0].values.some((value) => value.includes("event-1")));
  header.activity.update({ known: false, error: "断线" });
  assert.equal(header.activity.element.textContent, "占用状态未知");
  header.update(model("next.txt"));
  assert.equal(header.activity.element.classList.contains("hidden"), true);
});
