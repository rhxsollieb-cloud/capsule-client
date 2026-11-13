import assert from "node:assert/strict";
import test from "node:test";
import { ActivitySession, activityPresentation, tabClientId } from "../web/activity.mjs";
import { Workspace } from "../web/workspace.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const snapshot = (name, more = {}) => ({ name, editors: [], editorCount: 0, editorsTruncated: false, events: [], eventCount: 0,
  eventsTruncated: false, office: { active: false, saving: false }, ttlSeconds: 45, ...more });

function clock() {
  let time = 0, sequence = 0;
  const timers = new Map();
  return {
    now: () => time,
    schedule(callback, delay) { const id = ++sequence; timers.set(id, { callback, due: time + delay }); return id; },
    cancel(id) { timers.delete(id); },
    get pending() { return timers.size; },
    async advance(milliseconds) {
      time += milliseconds;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].due - b[1].due)) {
        if (timer.due > time || !timers.delete(id)) continue;
        timer.callback();
        await flush();
      }
    },
  };
}

function fixture(t, respond = (_operation, input) => snapshot(input.name)) {
  const timing = clock();
  const calls = [], states = [], signals = [];
  let number = 0;
  const session = new ActivitySession({
    ...timing, ownerId: "per-tab-id", createId: () => `session-${++number}`,
    request: async (operation, input, options) => { calls.push({ operation, input }); signals.push(options.signal); return respond(operation, input); },
    onChange: (state) => states.push(state),
  });
  t.after(() => session.destroy());
  return { session, calls, states, signals, timing };
}

test("编辑心跳复用当前session，10秒刷新且dirty即时更新有节流", async (t) => {
  const { session, calls, timing } = fixture(t);
  const target = { name: "手册.md", scope: "content", entry: "README.md", dirty: false };
  session.setTarget(target);
  await flush();
  assert.equal(session.state.known, true);
  assert.deepEqual(calls[0], { operation: "activity-heartbeat", input: { name: "手册.md", clientId: "per-tab-id", sessionId: "session-1", scope: "content", entry: "README.md", dirty: false } });
  await timing.advance(10000);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].input.sessionId, "session-1");
  session.setTarget({ ...target, dirty: true });
  await timing.advance(499);
  assert.equal(calls.length, 2);
  await timing.advance(1);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].input.dirty, true);
  session.setTarget({ ...target, dirty: true });
  await timing.advance(499);
  assert.equal(calls.length, 3);
  session.clear();
  await session.releasing;
  assert.equal(calls.at(-1).operation, "activity-release");
  assert.equal(calls.at(-1).input.sessionId, "session-1");
  assert.equal(timing.pending, 0);
});

test("只读内容仅GET活动，切换编辑时释放自身旧会话且新session独立", async (t) => {
  const { session, calls, timing } = fixture(t);
  session.setTarget({ name: "只读.mp4" });
  await flush();
  assert.equal(calls[0].operation, "activity");
  assert.deepEqual(calls[0].input, { name: "只读.mp4", clientId: "per-tab-id" });
  await timing.advance(10000);
  assert.equal(calls[1].operation, "activity");
  session.setTarget({ name: "数据", scope: "database", dirty: false });
  await flush();
  const first = calls.at(-1).input.sessionId;
  session.setTarget({ name: "数据", scope: "details", dirty: true });
  await flush();
  const heartbeats = calls.filter((call) => call.operation === "activity-heartbeat");
  assert.notEqual(heartbeats.at(-1).input.sessionId, first);
  assert.ok(calls.some((call) => call.operation === "activity-release" && call.input.sessionId === first));
  assert.equal(calls.filter((call) => call.operation === "activity-release").length, 1);
});

test("切换取消旧请求并释放专属session，旧晚响应不能覆盖新cap或删除新会话", async (t) => {
  let accept;
  const { session, calls, signals } = fixture(t, (operation, input) => input.name === "旧" && operation === "activity-heartbeat"
    ? new Promise((resolve) => { accept = resolve; }) : snapshot(input.name));
  session.setTarget({ name: "旧", scope: "office", dirty: false });
  await flush();
  session.setTarget({ name: "新", scope: "content", dirty: false });
  await flush();
  assert.equal(session.state.data.name, "新");
  assert.equal(signals[0].aborted, true);
  assert.equal(calls.some((call) => call.operation === "activity-release"), true);
  accept(snapshot("旧", { editorCount: 4 }));
  await flush();
  assert.equal(session.state.data.name, "新");
  const release = calls.find((call) => call.operation === "activity-release");
  assert.equal(release.input.name, "旧");
  assert.equal(release.input.sessionId, "session-1");
  assert.equal(session.target.sessionId, "session-2");
});

test("失败、无效回执和挂起连接显示未知，后台重试无未处理拒绝", async (t) => {
  let mode = "failure", accept;
  const { session, timing } = fixture(t, (_operation, input) => {
    if (mode === "failure") throw new Error("断线");
    if (mode === "invalid") return {};
    if (mode === "hung") return new Promise((resolve) => { accept = resolve; });
    return snapshot(input.name);
  });
  session.setTarget({ name: "正文", scope: "content", dirty: true });
  await flush();
  assert.equal(session.state.known, false);
  assert.equal(activityPresentation(session.state).label, "占用状态未知");
  mode = "invalid";
  await timing.advance(10000);
  assert.match(session.state.error, /回执无效/);
  mode = "hung";
  await timing.advance(10000);
  await timing.advance(8000);
  assert.equal(session.state.known, false);
  assert.match(session.state.error, /超时/);
  mode = "success";
  await timing.advance(10000);
  assert.equal(session.state.known, true);
  // A request implementation that ignores AbortSignal still cannot publish its late response.
  accept(snapshot("正文", { editorCount: 99 }));
  await flush();
  assert.equal(session.state.known, true);
  assert.equal(session.state.data.editorCount, 0);
  assert.equal(activityPresentation(session.state).label, "");
});

test("BFCache恢复重新登记新session，正常退出不自动恢复", async (t) => {
  const previous = globalThis.window;
  const events = new Map();
  globalThis.window = {
    addEventListener: (type, listener) => events.set(type, listener),
    removeEventListener: (type) => events.delete(type),
  };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const { session, calls } = fixture(t);
  session.setTarget({ name: "资料", scope: "details", dirty: true });
  await flush();
  events.get("pagehide")({ persisted: true });
  await flush();
  assert.equal(session.target, null);
  assert.equal(calls.at(-1).operation, "activity-release");
  events.get("pageshow")({ persisted: true });
  await flush();
  assert.equal(session.target.sessionId, "session-2");
  assert.equal(session.target.dirty, true);
  events.get("pagehide")({ persisted: false });
  events.get("pageshow")({ persisted: false });
  await flush();
  assert.equal(session.target, null);
});

test("实际浏览器action传递AbortSignal，挂起fetch超时后无需旧响应也能继续查询", async (t) => {
  const timing = clock();
  let firstSignal, calls = 0;
  t.mock.method(globalThis, "fetch", (_url, init) => {
    calls++;
    const fields = JSON.parse(init.body);
    if (calls !== 1) return Promise.resolve(Response.json(snapshot(fields.name)));
    firstSignal = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  const session = new ActivitySession({ ...timing, ownerId: "tab", createId: () => "session" });
  t.after(() => session.destroy());
  session.setTarget({ name: "正文", scope: "content", dirty: false });
  await flush();
  await timing.advance(8000);
  assert.equal(firstSignal.aborted, true);
  assert.equal(session.state.known, false);
  await timing.advance(10000);
  assert.equal(calls, 2);
  assert.equal(session.state.known, true);
});

test("工作区与属性会话互不释放，共用tab身份但session独立", async (t) => {
  const timing = clock(), calls = [];
  const request = async (operation, input) => { calls.push({ operation, input }); return snapshot(input.name); };
  const workspace = new ActivitySession({ ...timing, request });
  const inspector = new ActivitySession({ ...timing, request });
  t.after(() => { workspace.destroy(); inspector.destroy(); });
  assert.equal(workspace.ownerId, tabClientId());
  assert.equal(inspector.ownerId, workspace.ownerId);
  workspace.setTarget({ name: "中央.docx", scope: "office", dirty: true });
  inspector.setTarget({ name: "图片.png", scope: "details", dirty: true });
  await flush();
  const current = workspace.target.sessionId;
  assert.notEqual(inspector.target.sessionId, current);
  inspector.clear();
  await inspector.releasing;
  assert.equal(workspace.target.sessionId, current);
  assert.equal(calls.filter((call) => call.operation === "activity-release").length, 1);
  assert.equal(calls.at(-1).input.name, "图片.png");
});

test("提示区分会话、脏更改、队列与Office，截断和未知状态不冒称空闲", () => {
  const state = { known: true, data: snapshot("资料", {
    editors: [{ scope: "content", entry: "正文.md", dirty: true, count: 2 }], editorCount: 30, editorsTruncated: true,
    events: [{ id: "running-id", type: "revert", status: "running" }, { id: "pending-id", type: "delete", status: "pending" }],
    eventCount: 12, eventsTruncated: true, office: { active: true, saving: true },
  }) };
  const result = activityPresentation(state);
  for (const text of ["30 个编辑会话", "待保存", "处理中", "排队", "Office保存中"]) assert.ok(result.label.includes(text));
  assert.ok(result.detail.some((text) => text.includes("不是人数")));
  assert.ok(result.detail.some((text) => text.includes("仅显示部分")));
  assert.ok(result.detail.some((text) => text.includes("running-id")));
  assert.equal(activityPresentation({ known: false, error: "断线" }).unknown, true);
  const blocked = activityPresentation({ known: true, data: { ...state.data, queue: { state: "running", blocked: true, errors: [{ code: "RECOVERY_FAILED", status: 500, eventId: "recovery-id" }] } } });
  assert.ok(blocked.label.startsWith("事件待恢复"));
  assert.equal(blocked.warning, true);
  assert.ok(blocked.detail.some((text) => text.includes("recovery-id")));
  const closed = activityPresentation({ known: true, data: snapshot("资料", { queue: { state: "closed", blocked: true, errors: [], error: { code: "QUEUE_CLOSED", status: 503 } } }) });
  assert.equal(closed.label, "队列异常");
  const lockWait = activityPresentation({ known: true, data: snapshot("资料", { queue: { state: "idle", blocked: true,
    errors: [{ code: "LOCK_BUSY", status: 409, eventId: "waiting-event" }], error: { code: "LOCK_BUSY", status: 409 } } }) });
  assert.equal(lockWait.label, "等待占用释放");
  assert.equal(lockWait.warning, false);
  assert.ok(lockWait.detail.some((text) => text.includes("waiting-event")));
  assert.equal(activityPresentation({ known: true, data: snapshot("旧服务") }).label, "");
});

test("Workspace按实际视图注册，活动更新不调用load或重建Office", () => {
  const calls = [];
  const office = { hasDirty: () => true };
  const workspace = Object.assign(Object.create(Workspace.prototype), {
    cap: { name: "知识", kind: "files" }, mode: "content", entry: "正文.md", detailsMode: false,
    editingContent: { name: "知识", entry: "正文.md", details: false }, editor: { hasDirty: () => true },
    activity: { setTarget: (target) => calls.push(target) },
    load() { assert.fail("活动提示不能重建内容"); },
  });
  workspace.updateActivity();
  assert.deepEqual(calls.at(-1), { name: "知识", scope: "content", entry: "正文.md", dirty: true });
  workspace.entry = "其他.md";
  workspace.updateActivity();
  assert.equal(calls.at(-1).scope, undefined);
  workspace.office = office;
  workspace.updateActivity();
  assert.equal(calls.at(-1).scope, "office");
  assert.equal(workspace.office, office);
  workspace.office = null;
  workspace.mode = "database";
  workspace.database = { record: { editable: true }, hasDirty: () => false };
  workspace.updateActivity();
  assert.equal(calls.at(-1).scope, "database");
  workspace.database.record.editable = false;
  workspace.updateActivity();
  assert.equal(calls.at(-1).scope, undefined);
  workspace.mode = "history";
  workspace.updateActivity();
  assert.equal(calls.at(-1).scope, undefined);
});

test("正文后台读取期间新增草稿仍保留编辑presence与原上下文", async (t) => {
  let resolve, dirty = false, marked = false;
  t.mock.method(globalThis, "fetch", () => new Promise((accept) => { resolve = accept; }));
  const targets = [];
  const context = { name: "正文.txt", entry: undefined, details: false };
  const workspace = Object.assign(Object.create(Workspace.prototype), {
    cap: { name: "正文.txt", kind: "text", commit: "old" }, selection: 1, viewRequest: 0,
    mode: "content", detailsMode: false, editingContent: context,
    activity: { setTarget: (target) => targets.push(target) },
    editor: { hasDirty: () => dirty, markRemote() { marked = true; workspace.updateActivity(); } },
    onError(error) { throw error; },
  });
  const pending = workspace.load({ background: true });
  dirty = true;
  resolve(Response.json({ name: "正文.txt", body: "外部版本", token: "external", lines: { nextLine: null } }));
  await pending;
  assert.equal(marked, true);
  assert.equal(workspace.editingContent, context);
  assert.equal(targets.at(-1).scope, "content");
  assert.equal(targets.at(-1).dirty, true);
});
