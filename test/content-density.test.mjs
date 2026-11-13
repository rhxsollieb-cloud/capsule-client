import test from "node:test";
import assert from "node:assert/strict";
import { filesView, mediaView } from "../web/views.mjs";
import { NativeNavigator } from "../web/native-navigation.mjs";

function documentFixture(t) {
  const previous = globalThis.document;
  function element(tag) {
    const value = {
      tag, children: [], attributes: {}, listeners: {}, dataset: {}, className: "",
      append(...children) { this.children.push(...children); },
      prepend(...children) { this.children.unshift(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(name, content) { this.attributes[name] = content; if (name === "class") this.className = content; },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      querySelectorAll() { return []; },
      contains() { return false; },
      fire(type) { this.listeners[type]?.(); },
      click() { this.fire("click"); },
    };
    value.classList = {
      contains: (name) => value.className.split(/\s+/).includes(name),
      remove(name) { value.className = value.className.split(/\s+/).filter((item) => item !== name).join(" "); },
    };
    return value;
  }
  globalThis.document = { createElement: element, createElementNS: (_namespace, tag) => element(tag) };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  return element("main");
}

function all(element) { return [element, ...element.children.flatMap(all)]; }

test("媒体直接浏览时仍保留原生控制、异常提示和详情回调", (t) => {
  const container = documentFixture(t);
  for (const [kind, extension, tag] of [["image", "png", "img"], ["audio", "mp3", "audio"], ["video", "mp4", "video"]]) {
    let context;
    const name = `媒体.${extension}`;
    mediaView(container, { name, kind }, undefined, (value) => { context = value; });
    const wrapper = container.children[0];
    assert.equal(wrapper.children.length, 1);
    const elements = all(wrapper);
    const media = elements.find((item) => item.tag === tag);
    assert.equal(media.src, `/ui/content?name=${encodeURIComponent(name)}`);
    if (kind === "image") Object.assign(media, { naturalWidth: 800, naturalHeight: 600 });
    else { assert.equal(media.controls, true); media.duration = 65; }
    media.fire(kind === "image" ? "load" : "loadedmetadata");
    assert.equal(context.label, "媒体信息");
    assert.ok(context.values.includes(kind === "image" ? "800 × 600 px" : "时长 1:05"));
    const error = elements.find((item) => item.classList.contains("error-message"));
    media.fire("error");
    assert.equal(error.classList.contains("hidden"), false);
    assert.equal(elements.some((item) => ["h1", "h2", "a"].includes(item.tag)), false);
  }
});

test("精简文件集合保留打开入口、文件访问及分页", (t) => {
  const container = documentFixture(t);
  const opened = [];
  const pages = [];
  filesView(container, { name: "工具", kind: "code", description: "简介", runtime: { entry: "main.mjs" } }, {
    items: [{ path: "main.mjs", size: 20 }], total: 101, nextOffset: 100,
  }, (entry) => opened.push(entry), (offset) => pages.push(offset));
  const elements = all(container);
  assert.equal(elements.some((item) => item.tag === "h1" || item.textContent === "简介"), false);
  const entry = elements.find((item) => item.textContent === "打开入口");
  assert.equal(entry.title, "main.mjs");
  entry.click();
  elements.find((item) => item.classList.contains("file-row")).click();
  elements.find((item) => item.textContent === "加载更多").click();
  assert.deepEqual(opened, ["main.mjs", "main.mjs"]);
  assert.deepEqual(pages, [100]);
  assert.equal(elements.find((item) => item.classList.contains("file-list")).attributes["aria-label"], "文件列表，共 101 个文件");
});

test("第二列移除说明行后保留文件访问、刷新和数据库切换", (t) => {
  const container = documentFixture(t);
  const opened = [];
  let refreshes = 0;
  const navigator = Object.assign(Object.create(NativeNavigator.prototype), {
    element: container, cap: { name: "资料", kind: "markdown" }, mode: "files", expanded: new Set(),
    entries: [{ path: "README.md", size: 12 }], onOpenEntry: (entry) => opened.push(entry),
    load() { refreshes++; },
  });
  navigator.render();
  assert.equal(container.children.length, 2);
  all(container).find((item) => item.classList.contains("native-entry")).click();
  all(container).find((item) => item.attributes["aria-label"] === "刷新内部内容").click();
  assert.deepEqual(opened, ["README.md"]);
  assert.equal(refreshes, 1);
  Object.assign(navigator, { cap: { name: "数据", kind: "database" }, mode: "tables", tables: [{ name: "logs" }] });
  navigator.render();
  const labels = all(container).filter((item) => item.classList.contains("tab-button")).map((item) => item.textContent);
  assert.deepEqual(labels, ["数据表", "文件"]);
});
