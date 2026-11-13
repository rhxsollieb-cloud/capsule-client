import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { dispatch } from "../src/commands/dispatch.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { help } from "../src/commands/help.mjs";
import { heartbeatActivity, readActivity, releaseActivity } from "../src/operations/activity.mjs";
import { performAction } from "../src/ui/actions.mjs";

const clientId = "0d876654-1fdb-4343-bb2a-18fc45de3ba7";
const sessionId = "27b1c1f8-b10c-480c-8f7b-1dbda99e00dc";
const snapshot = {
  name: "说明.md", editors: [{ scope: "content", dirty: true, count: 2 }], editorCount: 2,
  events: [{ id: "event-1", type: "revert", status: "running", createdAt: "2026-11-12T00:00:00Z" }],
  eventCount: 1, eventsTruncated: false, office: { active: false, saving: false }, ttlSeconds: 45,
};

function fixture() {
  const calls = [];
  const api = new ApiClient({ serverUrl: "https://server.invalid", token: "server-credential" }, async (url, init) => {
    calls.push({ url: new URL(url), method: init.method, headers: new Headers(init.headers), body: init.body === undefined ? undefined : JSON.parse(init.body) });
    return Response.json(init.method === "DELETE" ? { released: true } : snapshot);
  });
  return { api, calls };
}

test("activity CLI只读查询真实远端状态，发现帮助不创建会话", async () => {
  const { api, calls } = fixture();
  assert.deepEqual(await dispatch(parseArguments(["activity", "说明.md"]), api), snapshot);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(decodeURIComponent(calls[0].url.pathname), "/api/capsules/说明.md/activity");
  assert.equal(calls[0].url.search, "");
  assert.equal(calls[0].body, undefined);
  const schema = JSON.parse(help("activity", { json: true }));
  assert.deepEqual(schema.arity, [1, 1]);
  assert.match(schema.help, /不是人数/);
  assert.match(schema.help, /不是排他锁/);
  for (const args of [["activity"], ["activity", "a", "b"], ["activity", "a", "--clientId", clientId], ["activity", "a", "--token", "version"]])
    assert.throws(() => parseArguments(args));
});

test("共享占用操作和BFF仅传协议字段，无cap token，心跳与独立释放保持会话标识", async () => {
  const { api, calls } = fixture();
  assert.deepEqual(await readActivity(api, { name: "说明.md", clientId: clientId.toUpperCase() }), snapshot);
  const heartbeat = { name: "说明.md", clientId, sessionId, scope: "content", entry: "docs/说明.md", dirty: true };
  assert.deepEqual(await heartbeatActivity(api, heartbeat), snapshot);
  assert.deepEqual(await performAction(api, { action: "activity", name: "说明.md", clientId }), snapshot);
  assert.deepEqual(await performAction(api, { action: "activity-heartbeat", ...heartbeat, scope: "details", dirty: false }), snapshot);
  assert.deepEqual(await performAction(api, { action: "activity-release", name: "说明.md", clientId, sessionId }), { released: true });
  assert.deepEqual(await releaseActivity(api, { name: "说明.md", clientId, sessionId }), { released: true });
  assert.deepEqual(calls.map((call) => call.method), ["GET", "POST", "GET", "POST", "DELETE", "DELETE"]);
  assert.equal(calls[0].url.searchParams.get("clientId"), clientId);
  assert.deepEqual(calls[1].body, { clientId, sessionId, scope: "content", entry: "docs/说明.md", dirty: true });
  assert.deepEqual(calls[3].body, { clientId, sessionId, scope: "details", entry: "docs/说明.md", dirty: false });
  for (const call of calls) {
    assert.equal(call.headers.get("If-Match"), null);
    assert.equal(call.headers.get("Authorization"), "Bearer server-credential");
    assert.equal(Object.hasOwn(call.body || {}, "token"), false);
    assert.equal(Object.hasOwn(call.body || {}, "name"), false);
  }
  assert.deepEqual(calls[4].body, { clientId, sessionId });
});

test("占用参数在客户端严格校验，未知字段、原型操作、非UUID与越界路径不发请求", async () => {
  const { api, calls } = fixture();
  const base = { name: "说明.md", clientId, sessionId, scope: "content", dirty: false };
  const badHeartbeat = [
    { ...base, clientId: "arbitrary-tab" }, { ...base, sessionId: undefined },
    { ...base, scope: "constructor" }, { ...base, scope: "lock" }, { ...base, dirty: "false" },
    { ...base, dirty: undefined }, { ...base, entry: "../outside.md" }, { ...base, entry: "/outside.md" },
    { ...base, token: "not-a-content-write" }, { ...base, name: "../说明.md" },
  ];
  for (const value of badHeartbeat)
    assert.throws(() => heartbeatActivity(api, value), (error) => error.status === 400 && error.code === "BAD_REQUEST");
  for (const value of [{ name: "说明.md", clientId: "" }, { name: "说明.md", sessionId }, { name: "说明.md", constructor: "no" }])
    assert.throws(() => readActivity(api, value), (error) => error.status === 400);
  assert.throws(() => releaseActivity(api, { name: "说明.md", clientId, sessionId, scope: "content" }), (error) => error.status === 400);
  assert.throws(() => releaseActivity(api, { name: "说明.md", clientId }), (error) => error.status === 400);
  await assert.rejects(performAction(api, { action: "activity", name: "说明.md", clientId, sessionId }), (error) => error.status === 400);
  await assert.rejects(performAction(api, { action: "activity-heartbeat", ...base, dirty: 0 }), (error) => error.status === 400);
  await assert.rejects(performAction(api, { action: "activity-release", name: "说明.md", clientId, sessionId, token: "unexpected" }), (error) => error.status === 400);
  for (const action of ["__proto__", "constructor", "toString"])
    await assert.rejects(performAction(api, { action, name: "说明.md" }), (error) => error.status === 400);
  assert.equal(calls.length, 0);
});

test("占用请求失败保持非零错误语义，不把失败伪造成无人编辑", async () => {
  const api = new ApiClient({ serverUrl: "https://server.invalid" }, async () => Response.json({ error: "暂不可用", code: "UNAVAILABLE" }, { status: 503 }));
  await assert.rejects(dispatch(parseArguments(["activity", "说明.md"]), api), (error) => error.status === 503 && error.code === "UNAVAILABLE");
  await assert.rejects(performAction(api, { action: "activity-heartbeat", name: "说明.md", clientId, sessionId, scope: "office", dirty: true }), (error) => error.status === 503 && error.code === "UNAVAILABLE");
});
