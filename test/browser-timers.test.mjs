import assert from "node:assert/strict";
import test from "node:test";
import { ActivitySession } from "../web/activity.mjs";
import { EditLeaseSession } from "../web/edit-lease.mjs";

test("活动与租约使用默认浏览器计时器时保留 Window receiver，选择和释放不会抛 Illegal invocation", async (t) => {
  const timers = new Map();
  let sequence = 0;
  t.mock.method(globalThis, "setTimeout", function (operation, delay) {
    assert.equal(this, globalThis, "浏览器计时器需要 Window receiver");
    const id = ++sequence;
    timers.set(id, { operation, delay });
    return id;
  });
  t.mock.method(globalThis, "clearTimeout", function (id) {
    assert.equal(this, globalThis, "不能把 clearTimeout 作为活动/租约对象的原生方法调用");
    timers.delete(id);
  });
  const activity = new ActivitySession({ ownerId: "test-tab", createId: () => "test-session", document: undefined,
    request: async (_operation, input) => ({ name: input.name, editors: [], editorCount: 0, events: [], eventCount: 0,
      eventsTruncated: false, office: { active: false, saving: false }, ttlSeconds: 45 }),
  });
  activity.clear();
  activity.setTarget({ name: "README.md" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activity.state.known, true);
  assert.ok(timers.size > 0);
  activity.destroy();
  const lease = new EditLeaseSession({ request: async () => undefined });
  lease.release();
  assert.equal(await lease.call("test", {}), undefined);
  lease.destroy();
  assert.equal(timers.size, 0);
});
