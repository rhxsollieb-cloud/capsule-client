import assert from "node:assert/strict";
import test from "node:test";
import { EditLeaseSession, editLease, leaseMessage } from "../web/edit-lease.mjs";
import { TextEditor } from "../web/editor.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function timing() {
  let time = 0, sequence = 0;
  const timers = new Map();
  return { now: () => time, schedule(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: time + delay }); return id; },
    cancel(id) { timers.delete(id); },
    async advance(milliseconds) { time += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= time && timers.delete(id)) { timer.callback(); await flush(); } },
  };
}
const record = (id, token = true) => ({ lease: { id, scope: "content", owner: { id: "employee", name: "张同事" }, expiresAt: "2030-01-01T00:00:20.000Z", ...(token ? { token: "private-lease-proof" } : {}) }, ttlSeconds: 20 });
function fixture(t, request) {
  const clock = timing(), calls = [], states = [];
  let sequence = 0;
  const lease = new EditLeaseSession({ ...clock, createId: () => `id-${++sequence}`, onChange: (state) => states.push(state),
    request: async (operation, input, options) => { calls.push({ operation, input, options }); return request ? request(operation, input, options) : record(input.id, operation === "lease-acquire"); },
  });
  t.after(() => lease.destroy());
  return { lease, clock, calls, states };
}

test("编辑显式获取、5秒续租且proof不进入公开状态，释放立即发出", async (t) => {
  const { lease, clock, calls } = fixture(t);
  assert.equal(lease.proof, undefined);
  assert.equal(await lease.acquire("手册.md", "content"), "private-lease-proof");
  assert.equal(JSON.stringify(lease.state).includes("private-lease-proof"), false);
  await clock.advance(5000);
  assert.equal(calls.at(-1).operation, "lease-renew");
  assert.equal(calls.at(-1).options.lease, "private-lease-proof");
  assert.equal(lease.proof, "private-lease-proof");
  const released = lease.release();
  assert.equal(lease.proof, undefined);
  await released;
  assert.equal(calls.at(-1).operation, "lease-release");
  assert.equal(calls.at(-1).options.keepalive, true);
});

test("切换在获取响应前立即release，迟到响应不能恢复旧占用", async (t) => {
  let accept;
  const { lease, calls } = fixture(t, (operation, input) => operation === "lease-acquire" && input.name === "旧"
    ? new Promise((resolve) => { accept = resolve; }) : record(input.id, operation === "lease-acquire"));
  const pending = lease.acquire("旧", "content");
  await flush();
  await lease.release();
  assert.equal(calls.at(-1).operation, "lease-release");
  assert.equal(await lease.acquire("新", "content"), "private-lease-proof");
  accept(record("id-1"));
  assert.equal(await pending, undefined);
  assert.equal(lease.target.name, "新");
  assert.equal(lease.state.status, "held");
});

test("续租失败冻结proof，不自动重放或重新获取，草稿基线不变", async (t) => {
  const draft = { body: "保留输入", dirty: true, token: "read-version" };
  const { lease, clock, calls } = fixture(t, (operation, input) => {
    if (operation === "lease-renew") throw Object.assign(new Error("占用已失效"), { code: "EDIT_LEASE_LOST" });
    return record(input.id);
  });
  await lease.acquire("手册", "content");
  await clock.advance(5000);
  assert.equal(lease.state.status, "lost");
  assert.equal(lease.proof, undefined);
  assert.throws(() => lease.requireProof(), { code: "EDIT_LEASE_LOST" });
  await clock.advance(60000);
  assert.equal(calls.filter((call) => call.operation === "lease-acquire").length, 1);
  assert.deepEqual(draft, { body: "保留输入", dirty: true, token: "read-version" });
  assert.match(leaseMessage({ status: "busy", leases: [{ owner: { name: "李同事" } }] }), /李同事正在编辑/);
});

test("获取或续租的网络耗时不延长服务端20秒期限，超期晚响应不能解冻", async (t) => {
  let accept;
  const { lease, clock } = fixture(t, (operation, input) => operation === "lease-acquire"
    ? new Promise((resolve) => { accept = () => resolve(record(input.id)); }) : record(input.id, false));
  lease.timeoutMs = 30000;
  const acquiring = lease.acquire("延迟", "content");
  await flush();
  await clock.advance(21000);
  accept();
  await acquiring;
  assert.equal(lease.state.status, "lost");
  assert.equal(lease.proof, undefined);

  let acceptRenew;
  const other = fixture(t, (operation, input) => operation === "lease-renew"
    ? new Promise((resolve) => { acceptRenew = () => resolve(record(input.id, false)); }) : record(input.id));
  other.lease.timeoutMs = 30000;
  await other.lease.acquire("续租延迟", "content");
  await other.clock.advance(5000);
  await other.clock.advance(21000);
  acceptRenew(); await flush();
  assert.equal(other.lease.state.status, "lost");
  assert.equal(other.lease.proof, undefined);
});

test("同tab正文与属性共享一个cap占用，单面板关闭不释放另一个面板", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const input = JSON.parse(options.body); calls.push(input);
    return Response.json(record(input.id));
  });
  const first = editLease(), second = editLease();
  t.after(() => { first.release(); second.release(); });
  await first.acquire("同页共享", "content");
  await second.acquire("同页共享", "details");
  assert.equal(calls.filter((call) => call.action === "lease-acquire").length, 1);
  await first.release();
  assert.equal(calls.some((call) => call.action === "lease-release"), false);
  assert.equal(second.proof, "private-lease-proof");
  await second.release();
  assert.equal(calls.filter((call) => call.action === "lease-release").length, 1);
});

test("A保存晚到不会释放后来B的编辑占用；租约失效保留真实编辑器草稿并禁用保存", async (t) => {
  const calls = [];
  let finish;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const input = JSON.parse(options.body); calls.push(input);
    if (input.action === "save") return new Promise((resolve) => { finish = () => resolve(Response.json({ name: "旧A", token: "saved", commit: "saved" })); });
    return Response.json({ lease: { ...record(input.id).lease, token: `proof-${input.name}`, expiresAt: new Date(Date.now() + 20000).toISOString() }, ttlSeconds: 20 });
  });
  const editor = new TextEditor({ onSaved() {}, onError(error) { throw error; }, onDirty() {} });
  editor.renderNotice = () => {};
  t.after(() => editor.close());
  const a = { name: "旧A", token: "read-a", commit: "read-a" }, b = { name: "当前B", token: "read-b", commit: "read-b" };
  const draftA = { body: "A草稿", original: "A原文", dirty: true, baseToken: a.token };
  editor.drafts.set(editor.key(a.name), draftA);
  editor.current = { key: editor.key(a.name), cap: a, switchMode() {} };
  await editor.lease.acquire(a.name, "content");
  const saving = editor.save(a, undefined, draftA);
  editor.close();
  const draftB = { body: "B草稿", original: "B原文", dirty: true, baseToken: b.token };
  editor.drafts.set(editor.key(b.name), draftB);
  editor.current = { key: editor.key(b.name), cap: b, switchMode() { assert.fail("旧保存不应切换B模式"); } };
  await editor.lease.acquire(b.name, "content");
  finish(); await saving;
  assert.equal(editor.lease.proof, "proof-当前B");
  const bId = calls.find((call) => call.action === "lease-acquire" && call.name === b.name).id;
  assert.equal(calls.some((call) => call.action === "lease-release" && call.id === bId), false);
  editor.lease.invalidate(Object.assign(new Error("失联"), { code: "EDIT_LEASE_LOST" }));
  assert.equal(editor.controls(b.name).canSave, false);
  assert.equal(draftB.body, "B草稿"); assert.equal(draftB.baseToken, "read-b");
});
