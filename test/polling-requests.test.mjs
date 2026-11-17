import assert from "node:assert/strict";
import test from "node:test";
import { action } from "../web/api.mjs";
import { Inspector } from "../web/inspector.mjs";
import { OfficeView } from "../web/office.mjs";
import { OfficeState } from "../web/office-state.mjs";
import { EventPanel } from "../web/panel.mjs";

const settled = () => new Promise((resolve) => setImmediate(resolve));
test("同一只读请求合并进行中网络传输，返回独立对象且完成后重新鉴权", async (t) => {
  const replies = []; let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; return new Promise((resolve) => replies.push(resolve)); });
  const first = action("stat", { name: "same" }), second = action("stat", { name: "same" });
  assert.equal(calls, 1);
  replies.shift()(Response.json({ name: "same", permissions: { edit: true } }));
  const [a, b] = await Promise.all([first, second]);
  a.permissions.edit = false; assert.equal(b.permissions.edit, true);
  const next = action("stat", { name: "same" }); assert.equal(calls, 2);
  replies.shift()(Response.json({ name: "same", permissions: { edit: false } }));
  assert.equal((await next).permissions.edit, false);
});

test("写入、续期与外部取消请求不合并，写后查询不复用写前未返回读取", async (t) => {
  const calls = [], replies = [];
  t.mock.method(globalThis, "fetch", (_url, init) => {
    calls.push(JSON.parse(init.body)); return new Promise((resolve) => replies.push(resolve));
  });
  const old = action("stat", { name: "writes" });
  const writing = action("save", { name: "writes", token: "old", body: "new" });
  replies[1](Response.json({ token: "new" })); await writing;
  const fresh = action("stat", { name: "writes" }); assert.equal(calls.length, 3);
  replies[2](Response.json({ token: "new" })); replies[0](Response.json({ token: "old" }));
  assert.equal((await fresh).token, "new"); await old;
  const pending = [];
  for (const [name, options] of [["save", {}], ["lease-renew", {}], ["stat", { signal: new AbortController().signal }],
    ["stat", { keepalive: true }], ["stat", { lease: "proof" }]]) {
    const before = calls.length;
    pending.push(action(name, { name: "unshared" }, options), action(name, { name: "unshared" }, options));
    assert.equal(calls.length - before, 2, name);
  }
  for (const reply of replies.slice(3)) reply(Response.json({}));
  await Promise.all(pending);
});

test("未变版本的属性刷新只查概要与权限，不再传输详述正文", async (t) => {
  const calls = []; let mayEdit = true;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const input = JSON.parse(init.body); calls.push(input.action);
    return Response.json(input.action === "stat" ? { name: "props", token: "current", permissions: { edit: mayEdit } }
      : { name: "props", token: "new", body: "changed" });
  });
  const updates = [];
  const inspector = Object.assign(Object.create(Inspector.prototype), { element: { open: true }, current: { name: "props", token: "current" },
    request: 1, draft: { baseToken: "current" }, visible: () => true, update(value) { updates.push(value); this.current = value; },
    details: { syncLocal() {} }, note: {},
  });
  for (let i = 0; i < 12; i++) await inspector.refresh();
  assert.equal(calls.filter((name) => name === "details").length, 0);
  mayEdit = false; await inspector.refresh(); assert.equal(updates.at(-1).permissions.edit, false);
});

test("Office工作区版本刷新不重复查询会话，正在保存仍显式核对回执", async (t) => {
  const cap = { name: "office.docx", token: "current", commit: "commit" }, calls = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ id: "id", status: "saving", saveVersion: 0 }); });
  const view = Object.assign(Object.create(OfficeView.prototype), { cap, state: new OfficeState(cap), session: { id: "id" },
    isCurrent: () => true, lease: { release() {} }, controls() {}, receive() {},
  });
  for (let i = 0; i < 12; i++) view.refresh(cap);
  await settled(); assert.equal(calls.length, 0);
  await view.poll(); assert.equal(calls.length, 1);
});

test("跟踪事件只查询原回执，不再每次顺带下载整页事件列表", async (t) => {
  const calls = []; let pageReads = 0, finished = 0;
  t.mock.method(globalThis, "setTimeout", (callback) => { queueMicrotask(callback); return 1; });
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const input = JSON.parse(init.body); calls.push(input);
    return Response.json({ id: "tracked", type: "revert", name: "cap", status: calls.length < 3 ? "running" : "succeeded" });
  });
  const event = { id: "tracked", type: "revert", name: "cap", status: "pending" };
  const panel = Object.assign(Object.create(EventPanel.prototype), { watched: new Map(), finishing: new Set(), events: [event], mode: "events",
    element: { classList: { contains: () => false } }, open() {}, renderEvents() {},
    refresh() { pageReads++; }, onReverted() { finished++; }, onError(error) { throw error; },
  });
  await panel.watch(event);
  assert.deepEqual(calls.map((call) => call.action), ["event", "event", "event"]);
  assert.equal(pageReads, 0); assert.equal(finished, 1); assert.equal(panel.watched.size, 0);
});
