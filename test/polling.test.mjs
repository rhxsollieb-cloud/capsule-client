import assert from "node:assert/strict";
import test from "node:test";
import { startPolling, waitUntilVisible } from "../web/polling.mjs";
import { ActivitySession } from "../web/activity.mjs";

const settled = () => new Promise((resolve) => setImmediate(resolve));
function fixture(hidden = false) {
  const listeners = new Set(), timers = new Map();
  let serial = 0;
  const page = { hidden, addEventListener(_name, listener) { listeners.add(listener); }, removeEventListener(_name, listener) { listeners.delete(listener); } };
  return { page, timers, schedule(callback, delay) { const id = ++serial; timers.set(id, { callback, delay }); return id; },
    cancel(id) { timers.delete(id); }, visibility(hidden) { page.hidden = hidden; for (const listener of [...listeners]) listener(); },
    async tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); await timer.callback(); await settled(); },
  };
}

test("后台纯查询零轮询，回到可见立即刷新，慢请求期间不并发叠加", async () => {
  const clock = fixture(); let calls = 0, release;
  const poller = startPolling(() => { calls++; if (calls === 2) return new Promise((resolve) => { release = resolve; }); },
    { ...clock, document: clock.page, interval: 5000, immediate: true });
  await settled(); assert.equal(calls, 1); assert.equal(clock.timers.size, 1);
  clock.visibility(true); assert.equal(clock.timers.size, 0); assert.equal(calls, 1);
  clock.visibility(false); assert.equal(calls, 2);
  poller.wake(); poller.wake(); assert.equal(calls, 2);
  release(); await settled(); assert.equal(calls, 3); assert.equal(clock.timers.size, 1);
  poller.stop(); assert.equal(clock.timers.size, 0);
  clock.visibility(true); clock.visibility(false); assert.equal(calls, 3);
});

test("后台保存确认继续轮询，结束后回到低频并在隐藏时暂停", async () => {
  const clock = fixture(true); let calls = 0, saving = true;
  const poller = startPolling(() => { calls++; }, { ...clock, document: clock.page, immediate: true,
    interval: () => saving ? 1000 : 30000, whenHidden: () => saving });
  await settled(); assert.equal(calls, 1); assert.equal([...clock.timers.values()][0].delay, 1000);
  await clock.tick(); assert.equal(calls, 2);
  saving = false; await clock.tick(); assert.equal(calls, 2); assert.equal(clock.timers.size, 0);
  clock.visibility(false); await settled(); assert.equal(calls, 3); assert.equal([...clock.timers.values()][0].delay, 30000);
  poller.stop();
});

test("事件跟踪在隐藏时等待，恢复可见才查询原回执", async () => {
  const clock = fixture(true); let complete = false;
  const pending = waitUntilVisible(clock.page).then(() => { complete = true; });
  await settled(); assert.equal(complete, false);
  clock.visibility(true); await settled(); assert.equal(complete, false);
  clock.visibility(false); await pending; assert.equal(complete, true);
});

test("只读活动查询随隐藏暂停，编辑心跳不因纯查询调度被停止", async () => {
  const clock = fixture(), calls = [];
  const session = new ActivitySession({ ...clock, document: clock.page, ownerId: "tab", createId: () => "session",
    request: async (operation, input) => {
      calls.push(operation); return { name: input.name, editors: [], editorCount: 0, events: [], eventCount: 0,
        eventsTruncated: false, office: { active: false, saving: false }, ttlSeconds: 45 };
    } });
  session.setTarget({ name: "read" }); await settled(); assert.deepEqual(calls, ["activity"]);
  clock.visibility(true); assert.equal(clock.timers.size, 0);
  clock.visibility(false); await settled(); assert.deepEqual(calls, ["activity", "activity"]);
  session.setTarget({ name: "edit", scope: "content", dirty: true }); await settled();
  clock.visibility(true); assert.equal(clock.timers.size, 1);
  await clock.tick(); assert.equal(calls.at(-1), "activity-heartbeat");
  session.destroy(); await session.releasing;
});
