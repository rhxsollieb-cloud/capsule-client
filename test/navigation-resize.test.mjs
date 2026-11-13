import test from "node:test";
import assert from "node:assert/strict";
import { fitNavigationWidths, navigationWidthRange, NavigationResize } from "../web/navigation-resize.mjs";

test("两列宽度为正文留出空间，缩小视口不破坏用户偏好", () => {
  const preferred = { library: 470, native: 500 };
  const fit = fitNavigationWidths(preferred, 850, true);
  assert.ok(fit.library >= 160);
  assert.ok(fit.native >= 150);
  assert.ok(fit.library + fit.native <= 850 - 260);
  assert.deepEqual(preferred, { library: 470, native: 500 });
  assert.deepEqual(fitNavigationWidths(preferred, 1500, true), preferred);
  assert.deepEqual(fitNavigationWidths(preferred, 400, true), { library: 160, native: 150 });
  assert.equal(navigationWidthRange("library", { library: 220, native: 200 }, 900, true).max, 440);
  assert.equal(navigationWidthRange("native", { library: 220, native: 200 }, 900, true).max, 420);
});

function fixture(t, storage) {
  const prior = Object.fromEntries(["document", "window", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const element = () => {
    const classes = new Set();
    return {
      children: [], dataset: {}, attributes: {}, style: { values: {}, setProperty(name, value) { this.values[name] = value; } },
      classList: { contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
      insertBefore(child, before) { const index = this.children.indexOf(before); if (index < 0) this.children.push(child); else this.children.splice(index, 0, child); },
      addEventListener() {}, removeEventListener() {}, remove() {}, focus() {},
      setAttribute(name, value) { this.attributes[name] = value; },
    };
  };
  globalThis.document = { createElement: element, body: element(), addEventListener() {}, removeEventListener() {} };
  globalThis.window = { innerWidth: 1100, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  const workspace = element();
  workspace.clientWidth = 1100;
  workspace.classList.add("has-native");
  const resize = new NavigationResize({ workspace, library: { id: "knowledge-navigation" }, nativeNavigation: { id: "native-navigation" } });
  t.after(() => {
    resize.destroy();
    for (const [key, descriptor] of Object.entries(prior)) { if (descriptor === undefined) delete globalThis[key]; else Object.defineProperty(globalThis, key, descriptor); }
  });
  return { resize, workspace };
}

test("宽度恢复、键盘边界和折叠还原保留各列偏好", (t) => {
  let saved;
  const { resize, workspace } = fixture(t, { getItem: () => JSON.stringify({ library: 280, native: 250 }), setItem(_key, value) { saved = JSON.parse(value); } });
  assert.deepEqual(resize.widths, { library: 280, native: 250 });
  const key = (value, extra = {}) => ({ key: value, preventDefault() {}, stopPropagation() {}, ...extra });
  resize.keydown("library", key("ArrowRight", { shiftKey: true }));
  assert.equal(resize.widths.library, 320);
  assert.equal(saved.library, 320);
  resize.keydown("native", key("Home"));
  assert.equal(resize.widths.native, 150);
  resize.keydown("native", key("End"));
  assert.equal(resize.widths.native, 520);
  const preferred = { ...resize.preferred };
  workspace.classList.add("library-collapsed");
  resize.apply();
  workspace.clientWidth = 600;
  resize.apply();
  assert.deepEqual(resize.preferred, preferred);
  workspace.classList.remove("library-collapsed");
  workspace.clientWidth = 1100;
  resize.apply();
  assert.deepEqual(resize.widths, preferred);
  assert.equal(resize.handles.library.attributes["aria-valuenow"], "320");
});

test("无效或被禁用的本地存储不妨碍调整", (t) => {
  const { resize } = fixture(t, { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  assert.deepEqual(resize.widths, { library: 224, native: 205 });
  resize.change("native", 275);
  resize.persist();
  assert.equal(resize.widths.native, 275);
});

test("拖动仅提交最终宽度，取消或折叠撤销未完成拖动并清理状态", (t) => {
  const saved = [];
  const { resize, workspace } = fixture(t, { getItem: () => null, setItem(_key, value) { saved.push(JSON.parse(value)); } });
  const pointer = (pointerId, clientX) => ({ pointerId, clientX, button: 0, preventDefault() {} });
  resize.start("library", pointer(1, 224));
  resize.move(pointer(2, 400));
  assert.equal(resize.widths.library, 224);
  resize.move(pointer(1, 294));
  assert.equal(resize.widths.library, 294);
  assert.equal(saved.length, 0);
  assert.equal(globalThis.document.body.classList.contains("navigation-resizing"), true);
  resize.end(pointer(1, 294));
  assert.equal(saved[0].library, 294);
  assert.equal(globalThis.document.body.classList.contains("navigation-resizing"), false);

  resize.start("native", pointer(3, 400));
  resize.move(pointer(3, 440));
  assert.equal(resize.widths.native, 245);
  resize.cancel(pointer(3, 440));
  assert.equal(resize.widths.native, 205);
  assert.equal(saved.length, 1);
  resize.start("library", pointer(4, 294));
  resize.move(pointer(4, 320));
  workspace.classList.add("library-collapsed");
  resize.apply();
  assert.equal(resize.drag, null);
  assert.equal(resize.preferred.library, 294);
  assert.equal(globalThis.document.body.classList.contains("navigation-resizing"), false);
});
