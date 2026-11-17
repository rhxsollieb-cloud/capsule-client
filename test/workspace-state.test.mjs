import assert from "node:assert/strict";
import test from "node:test";
import { Workspace } from "../web/workspace.mjs";

function navigationDocument(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => ({ tag }) };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
}

function navigationWorkspace(office) {
  const rendered = [], errors = [];
  const cap = { name: "旧 cap", kind: "files", commit: "old" };
  const workspace = Object.assign(Object.create(Workspace.prototype), {
    cap, item: { name: cap.name }, entry: "旧正文.txt", mode: "content", selection: 1, office,
    content: { querySelectorAll: () => [], replaceChildren() {} },
    editor: { close() {}, drafts: new Map([["旧 cap\0旧正文.txt", { dirty: true, body: "未保存草稿" }]]) },
    header: { update() {} }, navigation: { hide() {}, show() {}, selectEntry() {}, setMode() {}, selectTable() {} },
    inspector: { show() {}, context() {} },
    chrome() {},
    async load() { rendered.push({ name: this.cap.name, entry: this.entry, mode: this.mode }); },
    onError(error) { errors.push(error); },
  });
  return { workspace, rendered, errors, cap };
}

const navigationActions = [
  (workspace) => workspace.openFile("旧目录/附件.txt"),
  (workspace) => workspace.showFiles(),
  (workspace) => workspace.showDatabase("旧表"),
  (workspace) => workspace.showHistory(),
  (workspace) => workspace.showSkill(),
  (workspace) => workspace.openDetails({ name: "旧 cap", kind: "files", source: { type: "content", entry: "说明.md" } }),
  (workspace) => workspace.reopenOffice(),
];

test("旧 Office 离开晚到不能覆盖后来的 cap 选择或销毁当前页面", async (t) => {
  navigationDocument(t);
  t.mock.method(globalThis, "fetch", async (_url, request) => Response.json({ name: JSON.parse(request.body).name, kind: "text", commit: "new" }));
  let release, attempts = 0, destroyed = 0;
  const { workspace, rendered } = navigationWorkspace({
    prepareLeave: () => ++attempts === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(true),
    destroy() { destroyed++; },
  });
  const drafts = workspace.editor.drafts;
  const earlier = workspace.select({ name: "较早点击" });
  await workspace.select({ name: "最后点击" });
  release(true);
  assert.equal(await earlier, false);
  assert.equal(workspace.cap.name, "最后点击");
  assert.equal(workspace.item.name, "最后点击");
  assert.deepEqual(rendered.map((value) => value.name), ["最后点击"]);
  assert.equal(destroyed, 1);
  assert.equal(workspace.editor.drafts, drafts);
  assert.equal(drafts.get("旧 cap\0旧正文.txt").body, "未保存草稿");
});

test("旧内部文件、数据表及视图切换在离开等待期间失效，不应用到新 cap", async (t) => {
  navigationDocument(t);
  t.mock.method(globalThis, "fetch", async (_url, request) => Response.json({ name: JSON.parse(request.body).name, kind: "text", commit: "new" }));
  for (const navigate of navigationActions) {
    let release, attempts = 0;
    const { workspace, rendered, errors } = navigationWorkspace({
      prepareLeave: () => ++attempts === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(true),
      destroy() {},
    });
    const earlier = navigate(workspace);
    await workspace.select({ name: "新 cap" });
    release(true);
    assert.equal(await earlier, false);
    assert.equal(workspace.cap.name, "新 cap");
    assert.equal(workspace.entry, undefined);
    assert.equal(workspace.mode, "content");
    assert.deepEqual(rendered.map((value) => value.name), ["新 cap"]);
    assert.deepEqual(errors, []);
  }
});

test("Office 拒绝离开或离开异常时保留选择、页面与草稿，异常只报告一次", async () => {
  for (const reject of [false, true]) for (const navigate of [(workspace) => workspace.select({ name: "新 cap" }), ...navigationActions]) {
    const failure = new Error("Office 保存状态未确认");
    const { workspace, rendered, errors, cap } = navigationWorkspace({
      async prepareLeave() { if (reject) throw failure; return false; },
      destroy() { assert.fail("未确认离开不得销毁编辑器"); },
    });
    assert.equal(await navigate(workspace), false);
    assert.equal(workspace.cap, cap);
    assert.equal(workspace.selection, 1);
    assert.equal(workspace.entry, "旧正文.txt");
    assert.equal(workspace.editor.drafts.size, 1);
    assert.deepEqual(rendered, []);
    assert.deepEqual(errors, reject ? [failure] : []);
  }
});

test("同 cap 的旧 Office 重开查询不能覆盖较新的视图选择", async (t) => {
  let accept, entered;
  const querying = new Promise((resolve) => { entered = resolve; });
  t.mock.method(globalThis, "fetch", () => { entered(); return new Promise((resolve) => { accept = resolve; }); });
  const { workspace, rendered, cap } = navigationWorkspace(null);
  const earlier = workspace.reopenOffice();
  await querying;
  await workspace.showFiles();
  accept(Response.json({ ...cap, commit: "late" }));
  assert.equal(await earlier, false);
  assert.equal(workspace.cap, cap);
  assert.equal(workspace.mode, "files");
  assert.deepEqual(rendered, [{ name: "旧 cap", entry: undefined, mode: "files" }]);
});

test("内部视图加载异常被调用方捕获，不留下未处理的点击 Promise", async () => {
  const { workspace, errors } = navigationWorkspace(null);
  const failure = new Error("视图加载失败");
  workspace.load = async () => { throw failure; };
  assert.equal(await workspace.openFile("附件.txt"), false);
  assert.deepEqual(errors, [failure]);
});

test("旧目录晚到响应不能替换当前cap的文件分页与显示提交", async (t) => {
  const responses = new Map();
  t.mock.method(globalThis, "fetch", (_url, request) => {
    const { name } = JSON.parse(request.body);
    return new Promise((resolve) => responses.set(name, resolve));
  });
  const rendered = [];
  const workspace = Object.create(Workspace.prototype);
  Object.assign(workspace, {
    cap: { name: "旧资料包", kind: "files", commit: "old" },
    selection: 1,
    viewRequest: 0,
    mode: "files",
    inspector: { context() {} },
    renderFiles() { rendered.push(this.filePage); },
    showError(error) { throw error; },
  });
  const previous = workspace.load({ background: true });
  workspace.cap = { name: "新资料包", kind: "files", commit: "new" };
  workspace.selection++;
  const current = workspace.load({ background: true });
  const page = { items: [{ path: "当前.md", size: 20 }], total: 1, nextOffset: null };
  responses.get("新资料包")(Response.json(page));
  await current;
  responses.get("旧资料包")(Response.json({ items: [{ path: "过期.md", size: 10 }] }));
  await previous;
  assert.deepEqual(workspace.filePage, page);
  assert.equal(workspace.displayedCommit, "new");
  assert.deepEqual(rendered, [page]);
});

test("Office后台发现新提交仅通知当前会话，不重建正在编辑的文档", async (t) => {
  const current = { name: "原件.docx", kind: "word", commit: "old", token: "old-token" };
  const updated = { ...current, commit: "new", token: "new-token" };
  t.mock.method(globalThis, "fetch", async () => Response.json(updated));
  const refreshed = [];
  const office = { refresh: (cap) => refreshed.push(cap) };
  const workspace = Object.create(Workspace.prototype);
  Object.assign(workspace, {
    cap: current, office, selection: 1,
    inspector: { show() {} }, navigation: { update() {} },
    chrome() {},
    load() { throw new Error("Office会话不能被后台刷新重建"); },
    onError(error) { throw error; },
  });
  await workspace.refresh(true);
  assert.equal(workspace.office, office);
  assert.deepEqual(refreshed, [updated]);
  assert.equal(workspace.cap.commit, "new");
});

test("Office离开前保存未确认时保留当前选择和编辑器", async () => {
  const workspace = Object.create(Workspace.prototype);
  const cap = { name: "原件.docx" };
  Object.assign(workspace, { cap, selection: 2, office: { prepareLeave: async () => false, destroy() { throw new Error("未保存的编辑器不能销毁"); } } });
  assert.equal(await workspace.select({ name: "另一个文件" }), false);
  assert.equal(workspace.selection, 2);
  assert.equal(workspace.cap, cap);
});

test("收起的文件菜单保留当前操作且过期上下文不能影响后来选择", () => {
  const calls = [];
  let model;
  const workspace = Object.create(Workspace.prototype);
  Object.assign(workspace, {
    cap: { name: "工具", kind: "code", runtime: { command: "node" } },
    item: { path: "/工具" }, entry: "index.mjs", selection: 1, mode: "content",
    editor: { controls: () => null, hasDirty: () => false },
    header: { update(value) { model = value; } },
    inspector: { toggle() { calls.push("properties"); } },
    showHistory() { calls.push("history"); },
    onUpload(cap, entry) { calls.push([cap.name, entry]); },
    onRun(cap) { calls.push(cap.name); },
  });
  workspace.chrome();
  const upload = model.items.find((item) => item.icon === "upload");
  upload.action();
  assert.deepEqual(calls, [["工具", "index.mjs"]]);
  const previous = model.items.filter((item) => item.action);
  workspace.entry = "另一个.mjs";
  for (const item of previous) item.action();
  assert.equal(calls.length, 1);
  workspace.entry = "index.mjs";
  workspace.selection++;
  for (const item of previous) item.action();
  assert.equal(calls.length, 1);
});

test("整cap草稿核对覆盖其它文件和数据表，断链保留草稿并清除旧位置", () => {
  const text = { dirty: true };
  const table = { saving: true };
  const workspace = Object.assign(Object.create(Workspace.prototype), {
    cap: { name: "资料" }, item: { name: "资料", path: "/主题/资料" },
    editor: { drafts: new Map([["资料\0other.md", text]]) },
    databaseDrafts: new Map([["资料\0logs", table]]),
    inspector: { drafts: new Map() }, chrome() {},
  });
  assert.deepEqual(workspace.draftState("资料"), { dirty: true, saving: true });
  workspace.unlinked({ name: "资料", path: "/主题/资料" });
  assert.equal(workspace.item.path, undefined);
  assert.equal(workspace.editor.drafts.get("资料\0other.md"), text);
  assert.equal(workspace.databaseDrafts.get("资料\0logs"), table);
});

test("清除其它cap仅移除它的所有草稿，保留当前内容和相近名称", () => {
  const current = { name: "保留" };
  const workspace = Object.assign(Object.create(Workspace.prototype), {
    cap: current,
    editor: { drafts: new Map([["旧\0a.md", { dirty: true }], ["旧的\0a.md", { dirty: true }]]) },
    databaseDrafts: new Map([["旧\0logs", { dirty: true }]]),
    inspector: { drafts: new Map([["旧", { dirty: true }], ["保留", { dirty: true }]]) },
  });
  workspace.removed("旧");
  assert.equal(workspace.cap, current);
  assert.deepEqual([...workspace.editor.drafts.keys()], ["旧的\0a.md"]);
  assert.equal(workspace.databaseDrafts.size, 0);
  assert.deepEqual([...workspace.inspector.drafts.keys()], ["保留"]);
});

test("加载期间清除使旧stat失效，断链更新加载标题而不重新读取", async (t) => {
  const previous = globalThis.document;
  const element = () => ({ append() {}, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [], replaceChildren() {} });
  globalThis.document = { createElement: element, createElementNS: element };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  let release;
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { release = resolve; }));
  let title;
  const workspace = Object.assign(Object.create(Workspace.prototype), {
    cap: null, selection: 0, viewRequest: 0, databaseDrafts: new Map(),
    content: element(), editor: { drafts: new Map() },
    navigation: { hide() {} }, header: { update(model) { title = model; } },
    inspector: { drafts: new Map(), show() { assert.fail("已清除实体不能晚到显示"); } },
    onError(error) { throw error; },
  });
  const loading = workspace.select({ name: "旧.txt", path: "/旧.txt", kind: "text" });
  await new Promise((resolve) => setImmediate(resolve));
  workspace.unlinked({ name: "旧.txt", path: "/旧.txt", kind: "text" });
  assert.equal(title.path, "旧.txt");
  assert.equal(workspace.item.path, undefined);
  workspace.removed("旧.txt");
  release(Response.json({ name: "旧.txt", kind: "text", commit: "old", token: "old" }));
  await loading;
  assert.equal(workspace.cap, null);
  assert.equal(workspace.item, null);
  assert.equal(title, null);
});

test("Skill控件融入原DocumentHeader，文件与CLI入口保持单一且可切回", () => {
  let model;
  const controls = { state: "clean", moreItems: [{ label: "运行 Skill CLI", action() {} }, { label: "启动协作页面", action() {} }] };
  const workspace = Object.assign(Object.create(Workspace.prototype), {
    cap: { name: "工具", kind: "code", commit: "v1" }, item: { name: "工具", path: "/工具" }, mode: "skill", selection: 1,
    skillView: { controlsInfo: () => controls },
    editor: { controls: () => null }, header: { update(value) { model = value; } },
  });
  workspace.chrome();
  assert.equal(model.controls, controls);
  assert.equal(model.items.some((item) => item.label === "文件概览"), true);
  assert.equal(model.items.some((item) => item.label === "运行 Skill CLI"), false);
  workspace.mode = "content";
  workspace.entry = "scripts/cli.mjs";
  workspace.chrome();
  assert.equal(model.items.some((item) => item.label === "Skill 交互入口"), true);
  assert.equal(model.items.some((item) => item.label === "运行 Skill CLI"), true);
});
