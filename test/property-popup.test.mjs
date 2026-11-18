import test from "node:test";
import assert from "node:assert/strict";
import { Inspector } from "../web/inspector.mjs";
import { InspectorDetails } from "../web/inspector-details.mjs";
import { testLease } from "./leaseFixture.mjs";

function fixture(t, respond, options = {}) {
  const previous = globalThis.document;
  const closes = [];
  const createElement = (tag) => {
    const element = {
      tag, children: [], listeners: {}, attributes: {}, className: "", value: "", disabled: false,
      get parentElement() { return this.parent; },
      get isConnected() { return this.root || Boolean(this.parent?.isConnected); },
      append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
      replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; if (name === "src") delete this.src; },
      addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
      dispatch(type) { return Promise.all([this[`on${type}`], ...(this.listeners[type] || [])].filter(Boolean).map((listener) => listener({ target: this, preventDefault() {} }))); },
      querySelectorAll(selector) {
        const tags = selector.split(",").map((value) => value.trim());
        return this.children.flatMap((child) => [...(tags.includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)]);
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; },
      showModal() { this.open = true; },
      close() { this.open = false; closes.push(() => this.dispatch("close")); },
      pause() { this.pauses = (this.pauses || 0) + 1; },
      load() { this.loads = (this.loads || 0) + 1; },
      focus() {},
    };
    element.classList = {
      contains: (name) => element.className.split(/\s+/).includes(name),
      toggle(name, force) {
        const names = new Set(element.className.split(/\s+/).filter(Boolean));
        const include = force ?? !names.has(name);
        if (include) names.add(name); else names.delete(name);
        element.className = [...names].join(" ");
        return include;
      },
      add(name) { this.toggle(name, true); },
      remove(name) { this.toggle(name, false); },
    };
    return element;
  };
  const body = createElement("body");
  body.root = true;
  globalThis.document = { createElement, body };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const calls = [], saved = [], edits = [], errors = [];
  const renders = [];
  // This fixture exercises popup state and lifecycle; the shared Markdown engine owns parsing and sanitization.
  t.mock.method(InspectorDetails.prototype, "renderBody", (body, context) => {
    renders.push({ body, context });
    const article = createElement("article");
    article.className = "markdown-body";
    article.textContent = body;
    return article;
  });
  t.mock.method(globalThis, "fetch", (_url, init) => {
    const input = JSON.parse(init.body);
    calls.push(input);
    return Promise.resolve(respond(input)).then((value) => value instanceof Response ? value : Response.json(value));
  });
  const activityTargets = [];
  const inspector = new Inspector({ onSaved: (record) => saved.push(record), onEdit: (source) => edits.push(source), onError: (error) => errors.push(error),
    createLease: (onChange) => testLease(onChange, { held: false }),
    createActivity: () => ({ setTarget: (value) => activityTargets.push(value), clear: () => activityTargets.push(null) }), ...options });
  return { inspector, calls, saved, edits, errors, renders, activityTargets, flushCloses: async () => { for (const close of closes.splice(0)) await close(); } };
}

function record(name, { kind = "image", body = "详述正文", token = `${name}-token`, nextLine = null } = {}) {
  const metadata = !["text", "markdown", "files", "code", "database"].includes(kind);
  return { name, kind, description: "简述", token, commit: `${name}-commit`, body,
    source: metadata ? { type: "metadata" } : { type: "content", entry: kind === "text" ? name : kind === "markdown" ? "README.md" : "说明.md" },
    lines: { from: 1, to: nextLine ? nextLine - 1 : 1, total: nextLine ? nextLine + 1 : 1, nextLine, truncated: Boolean(nextLine) } };
}

test("打开其他cap属性不切换中央选择，后台选择更新不替换弹窗", async (t) => {
  const { inspector, edits, calls } = fixture(t, (input) => record(input.name));
  inspector.show({ name: "中央Office.docx", kind: "word" });
  await inspector.open({ name: "图片.png" });
  inspector.show({ name: "后来选择.docx", kind: "word" });
  assert.equal(inspector.current.name, "图片.png");
  assert.equal(inspector.selected.name, "后来选择.docx");
  assert.equal(inspector.description.value, "简述");
  assert.deepEqual(edits, []);
  assert.deepEqual(calls, [{ action: "details", name: "图片.png", from: 1, limit: 80 }]);
});

test("属性活动绑定弹窗cap与dirty，关闭释放且不使用中央选择", async (t) => {
  const { inspector, activityTargets } = fixture(t, (input) => record(input.name));
  inspector.show({ name: "中央Office.docx" });
  await inspector.open({ name: "另一个.png" });
  assert.deepEqual(activityTargets.at(-1), { name: "另一个.png", scope: undefined, dirty: false });
  await inspector.startEditing();
  assert.deepEqual(activityTargets.at(-1), { name: "另一个.png", scope: "details", dirty: false });
  inspector.description.value = "属性未保存说明";
  await inspector.description.dispatch("input");
  assert.deepEqual(activityTargets.at(-1), { name: "另一个.png", scope: "details", dirty: true });
  inspector.show({ name: "后来中央选择.docx" });
  assert.equal(activityTargets.at(-1).name, "另一个.png");
  inspector.hide();
  assert.equal(activityTargets.at(-1), null);
});

test("旧close事件及晚响应不能清空重开的属性，hide立即隔离未完成读取", async (t) => {
  const accepts = new Map();
  const { inspector, flushCloses } = fixture(t, (input) => new Promise((resolve) => accepts.set(input.name, resolve)));
  const first = inspector.open({ name: "旧cap" });
  const second = inspector.open({ name: "当前cap" });
  await flushCloses();
  accepts.get("旧cap")(record("旧cap"));
  await first;
  assert.equal(inspector.current, null);
  accepts.get("当前cap")(record("当前cap"));
  await second;
  assert.equal(inspector.current.name, "当前cap");
  const third = inspector.open({ name: "关闭的cap" });
  inspector.hide();
  accepts.get("关闭的cap")(record("关闭的cap"));
  await third;
  assert.equal(inspector.view, null);
  assert.equal(inspector.element.open, false);
});

test("未完整加载的metadata详述不能随简述保存覆盖全文", async (t) => {
  const { inspector, calls } = fixture(t, (input) => input.action === "details" ? record(input.name, { nextLine: 81 }) : { name: input.name, token: "saved-token", commit: "saved-commit" });
  await inspector.open({ name: "长说明.png" });
  assert.equal(inspector.draft.bodyReady, false);
  await inspector.startEditing();
  inspector.description.value = "更新简述";
  await inspector.description.dispatch("input");
  await inspector.save();
  assert.deepEqual(calls[1], { action: "update", name: "长说明.png", description: "更新简述", token: "长说明.png-token" });
  assert.equal(inspector.draft.bodyReady, false);
});

test("保存捕获原简述和详述，继续输入与切换弹窗都保留正确上下文", async (t) => {
  let accept;
  const { inspector, calls, saved } = fixture(t, (input) => input.action === "details" ? record(input.name) : new Promise((resolve) => { accept = resolve; }));
  await inspector.open({ name: "原cap.png" });
  await inspector.details.loadEditor();
  const draft = inspector.draft;
  inspector.description.value = "本次简述";
  await inspector.description.dispatch("input");
  inspector.details.input.value = "本次详述";
  await inspector.details.input.dispatch("input");
  const saving = inspector.save();
  inspector.details.input.value = "保存中继续输入";
  await inspector.details.input.dispatch("input");
  await inspector.open({ name: "后来cap.png" });
  await inspector.startEditing();
  const laterReservation = inspector.lease.capture();
  accept({ name: "原cap.png", token: "saved-token", commit: "saved-commit" });
  await saving;
  assert.deepEqual(calls[1], { action: "save-details", name: "原cap.png", description: "本次简述", body: "本次详述", token: "原cap.png-token" });
  assert.equal(draft.originalBody, "本次详述");
  assert.equal(draft.body, "保存中继续输入");
  assert.equal(draft.dirty, true);
  assert.equal(draft.saving, false);
  assert.equal(inspector.current.name, "后来cap.png");
  assert.equal(inspector.description.value, "简述");
  assert.equal(saved[0].name, "原cap.png");
  assert.equal(inspector.lease.proof, "test-edit-proof");
  assert.equal(inspector.lease.capture(), laterReservation);
});

test("正文预览使用现有草稿，放弃草稿后恢复原正文", (t) => {
  let draft = { body: "中央未保存正文", dirty: true };
  fixture(t, () => ({}));
  const details = new InspectorDetails({ isCurrent: () => true, getDraft: () => draft, onEdit() {}, onChange() {}, onError(error) { throw error; } });
  details.show(record("正文.txt", { kind: "text", body: "已保存正文" }), {});
  assert.equal(details.body.children[0].textContent, "中央未保存正文");
  draft = null;
  details.syncLocal();
  assert.equal(details.body.children[0].textContent, "已保存正文");
});

test("详述默认阅读Markdown，编辑与预览共用原文草稿并以原token保存", async (t) => {
  const original = "# 图片说明\n\n- **用途**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```";
  const edited = original + "\n\n新增说明";
  const { inspector, renders, calls } = fixture(t, (input) => input.action === "details" ? record(input.name, { body: original }) : { name: input.name, token: "new-token", commit: "new-commit" });
  await inspector.open({ name: "参考.png" });
  const details = inspector.details;
  assert.equal(details.mode, "read");
  assert.equal(details.input, null);
  assert.deepEqual(renders[0], { body: original, context: {} });
  await details.loadEditor();
  assert.equal(details.input.value, original);
  details.input.value = edited;
  await details.input.dispatch("input");
  details.read();
  assert.equal(details.mode, "read");
  assert.equal(renders.at(-1).body, edited);
  assert.equal(inspector.draft.body, edited);
  assert.equal(inspector.draft.baseToken, "参考.png-token");
  assert.equal(inspector.draft.dirty, true);
  assert.equal(calls.length, 1);
  await inspector.save();
  assert.deepEqual(calls[1], { action: "save-details", name: "参考.png", description: "简述", body: edited, token: "参考.png-token" });
  assert.equal(inspector.draft.dirty, false);
  assert.equal(details.note.textContent, "");
});

test("目录正文渲染保留本cap附件上下文，单文件详述不派生目录", async (t) => {
  const { inspector, renders } = fixture(t, (input) => record(input.name, { kind: input.name.endsWith(".md") ? "markdown" : "text" }));
  await inspector.open({ name: "目录.md" });
  assert.deepEqual(renders.at(-1).context, { name: "目录.md", entry: "README.md", token: "目录.md-token" });
  await inspector.open({ name: "正文.txt" });
  assert.deepEqual(renders.at(-1).context, {});
});

test("后台同步保留未变Markdown节点，草稿变更与关闭释放媒体", async (t) => {
  let draft = null;
  const { inspector, renders } = fixture(t, (input) => record(input.name, { kind: "markdown" }), { getDraft: () => draft });
  await inspector.open({ name: "手册.md" });
  const details = inspector.details;
  const article = details.body.children[0];
  const media = globalThis.document.createElement("video");
  media.src = "/ui/content?name=手册.md&entry=assets/demo.mp4";
  article.append(media);
  details.syncLocal();
  assert.equal(details.body.children[0], article);
  assert.equal(renders.length, 1);
  assert.equal(media.pauses, undefined);
  draft = { dirty: true, body: "# 未保存手册" };
  details.syncLocal();
  assert.equal(renders.at(-1).body, draft.body);
  assert.equal(media.pauses, 1);
  assert.equal(media.loads, 1);
  assert.equal(media.src, undefined);
  const nextMedia = globalThis.document.createElement("audio");
  nextMedia.src = "/ui/content?name=手册.md&entry=assets/demo.wav";
  details.body.children[0].append(nextMedia);
  inspector.hide();
  assert.equal(nextMedia.pauses, 1);
  assert.equal(nextMedia.src, undefined);
});

test("长详述完整读取后才进入编辑，分页版本冲突保留原草稿", async (t) => {
  let conflict = false;
  const { inspector, calls, errors } = fixture(t, (input) => input.from === 1 ? record(input.name, { body: "# 第一段", nextLine: 81 }) : record(input.name, { body: "第二段", token: conflict ? "external-token" : `${input.name}-token` }));
  await inspector.open({ name: "长说明.png" });
  await inspector.details.loadEditor();
  assert.equal(inspector.details.input.value, "# 第一段\n第二段");
  assert.equal(inspector.draft.bodyReady, true);
  assert.equal(calls[1].from, 81);
  await inspector.open({ name: "冲突说明.png" });
  conflict = true;
  await inspector.details.loadEditor();
  assert.equal(inspector.details.mode, "read");
  assert.equal(inspector.draft.bodyReady, false);
  assert.equal(inspector.draft.baseToken, "冲突说明.png-token");
  assert.match(errors.at(-1).message, /详述已变化/);
});

test("媒体按需浏览且关闭同步停止和释放，新弹窗不受旧close事件影响", async (t) => {
  const { inspector, flushCloses } = fixture(t, (input) => record(input.name, { kind: "video" }));
  await inspector.open({ name: "旧媒体.mp4" });
  const browse = inspector.element.querySelectorAll("details").find((element) => element.className === "property-browser");
  assert.equal(browse.querySelector("video"), null);
  browse.open = true;
  await browse.dispatch("toggle");
  const oldMedia = browse.querySelector("video");
  assert.ok(oldMedia.src.includes("name="));
  assert.equal(oldMedia.preload, "metadata");
  inspector.hide();
  assert.equal(oldMedia.pauses, 1);
  assert.equal(oldMedia.loads, 1);
  assert.equal(oldMedia.src, undefined);
  await inspector.open({ name: "新媒体.mp4" });
  await flushCloses();
  assert.equal(inspector.current.name, "新媒体.mp4");
  assert.equal(inspector.element.open, true);
});
