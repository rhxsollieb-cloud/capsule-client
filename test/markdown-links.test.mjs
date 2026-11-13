import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown, markdownOutline } from "../web/markdown.mjs";
import { DOMPurify } from "../web/vendor/markdown.mjs";

function fixture(t, hrefs) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const sanitizer = Object.getOwnPropertyDescriptor(DOMPurify, "sanitize");
  const rendered = [];
  function element(tag, attributes = {}) {
    return {
      tag, attributes, children: [], listeners: {},
      get id() { return this.attributes.id; },
      append(...children) { this.children.push(...children); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      removeAttribute(name) { delete this.attributes[name]; },
      addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
      querySelectorAll(selector) {
        const match = (value) => selector === "[id]" ? Object.hasOwn(value.attributes, "id") : value.tag === selector;
        return this.children.flatMap((child) => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
      },
      scrollIntoView(options) { this.scrolled = (this.scrolled || 0) + 1; this.scrollOptions = options; },
      click() {
        const event = { preventDefault() { this.defaultPrevented = true; } };
        for (const listener of this.listeners.click || []) listener(event);
        return event;
      },
    };
  }
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: element,
    getElementById() { assert.fail("Markdown锚点不能查找全局document"); },
  } });
  // This fixture covers post-sanitization link binding, not browser DOMPurify behavior.
  Object.defineProperty(DOMPurify, "sanitize", { configurable: true, value: (html) => {
    rendered.push(html);
    const fragment = element("fragment");
    fragment.append(element("h1", { id: "heading-0" }), ...hrefs.map((href) => element("a", { href })));
    return fragment;
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document;
    if (sanitizer) Object.defineProperty(DOMPurify, "sanitize", sanitizer); else delete DOMPurify.sanitize;
  });
  return { rendered };
}

test("多个Markdown视图有同名heading时，锚点仅滚动所属article", (t) => {
  const { rendered } = fixture(t, ["#heading-0"]);
  const source = "# 标题\n\n[返回](#heading-0)";
  const central = renderMarkdown(source);
  const popup = renderMarkdown(source);
  const centralHeading = central.querySelectorAll("[id]")[0];
  const popupHeading = popup.querySelectorAll("[id]")[0];
  const event = popup.querySelectorAll("a")[0].click();
  assert.equal(event.defaultPrevented, true);
  assert.equal(popupHeading.scrolled, 1);
  assert.deepEqual(popupHeading.scrollOptions, { block: "start" });
  assert.equal(centralHeading.scrolled, undefined);
  assert.match(rendered[0], /id="heading-0"/);
  assert.deepEqual(markdownOutline(source), [{ level: 1, text: "标题", id: "heading-0" }]);
});

test("锚点不拼接CSS选择器，HTTPS及本cap路径约束保持原规则", (t) => {
  fixture(t, ['#[id="heading-0"]', "https://example.invalid/reference", "assets/file.txt", "../outside.txt"]);
  const article = renderMarkdown("# 标题", { name: "手册", entry: "README.md" });
  const [unmatched, external, local, escaped] = article.querySelectorAll("a");
  assert.doesNotThrow(() => unmatched.click());
  assert.equal(article.querySelectorAll("[id]")[0].scrolled, undefined);
  assert.equal(external.target, "_blank");
  assert.equal(external.rel, "noopener noreferrer");
  assert.equal(local.href, "/ui/content?name=%E6%89%8B%E5%86%8C&entry=assets%2Ffile.txt&download=1");
  assert.equal(escaped.getAttribute("href"), null);
  const metadata = renderMarkdown("# 详述");
  assert.equal(metadata.querySelectorAll("a")[2].getAttribute("href"), null);
});
