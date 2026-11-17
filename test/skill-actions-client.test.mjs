import test from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../src/cli.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { performAction } from "../src/ui/actions.mjs";
import { ApiClient } from "../src/api/client.mjs";
import { ConnectionStore } from "../src/connection/store.mjs";

test("skill本机操作先校验身份及cap，再调用注入manager管理本机状态", async () => {
  const calls = [];
  const checks = [];
  const api = { path: (name) => "/cap/" + name, async json(path) { checks.push(path); return {}; } };
  const skills = Object.fromEntries(["register", "status", "start", "stop"].map((method) => [method, async (name) => {
    calls.push([method, name]);
    return { name, method };
  }]));
  for (const method of Object.keys(skills)) {
    assert.deepEqual(await performAction(api, { action: `skill-${method}`, name: "中文工具" }, { skills }), { name: "中文工具", method });
  }
  assert.deepEqual(calls, [["register", "中文工具"], ["status", "中文工具"], ["start", "中文工具"], ["stop", "中文工具"]]);
  assert.deepEqual(checks, Array.from({ length: 4 }, () => ["/api/access/me", "/cap/中文工具"]).flat());
  await assert.rejects(performAction(api, { action: "skill-start", name: "工具" }), (error) => error.status === 503);
  await assert.rejects(performAction(api, { action: "skill-start", name: "工具", command: "/bin/sh" }, { skills }), (error) => error.status === 400);
  await assert.rejects(performAction(api, { action: "skill-status", name: "../工具" }, { skills }), (error) => error.status === 400);
});

test("管理CLI通过同服务器及profile的本机通道以调用方会话复用状态", async (t) => {
  const calls = [];
  const connectionKey = new ConnectionStore({}).key;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    calls.push({ url: new URL(url), options });
    if (new URL(url).pathname === "/ui/session") return Response.json({ csrfToken: "host-session", serverUrl: "https://server.invalid", connectionKey });
    const headers = new Headers(options.headers);
    assert.equal(headers.get("Authorization"), "Bearer private-server-token");
    assert.equal(headers.get("X-Capsule-Server"), "https://server.invalid");
    assert.equal(headers.get("X-Capsule-Connection"), connectionKey);
    assert.equal(headers.get("X-Capsule-Session"), "host-session");
    assert.equal(headers.get("Origin"), "http://127.0.0.1:6000");
    return Response.json({ name: "工具", state: "registered" });
  });
  const api = { config: { clientUrl: "http://127.0.0.1:6000", serverUrl: "https://server.invalid", token: "private-server-token" } };
  const result = await dispatch(parseArguments(["skill-register", "工具"]), api);
  assert.equal(result.state, "registered");
  assert.deepEqual(calls.map((call) => call.url.origin), ["http://127.0.0.1:6000", "http://127.0.0.1:6000"]);
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: "skill-register", name: "工具" });
  assert.equal(calls.some((call) => call.url.href.includes("private-server-token") || call.options.body?.includes("private-server-token")), false);
});

test("通用运行入口有明确退役诊断，旧参数仅接受skill固定值", () => {
  assert.throws(() => parseArguments(["create", "工具", "--kind", "code", "--engine", "node", "--entry", "main.mjs"]), /已退役/u);
  assert.throws(() => parseArguments(["update", "工具", "--engine", "python", "--entry", "scripts/cli.mjs", "--token", "version"]), /已退役/u);
  assert.deepEqual(parseArguments(["create", "工具", "--kind", "code", "--engine", "node", "--entry", "scripts/cli.mjs"]).values,
    { kind: "code", engine: "node", entry: "scripts/cli.mjs" });
  assert.throws(() => parseArguments(["convert-skill", "工具"]), /--token/u);
});

test("本机管理通道保留桥接返回的未知结果与事件回执", async (t) => {
  const connectionKey = new ConnectionStore({}).key;
  t.mock.method(globalThis, "fetch", async (url) => new URL(url).pathname === "/ui/session"
    ? Response.json({ csrfToken: "host-session", serverUrl: "https://server.invalid", connectionKey })
    : Response.json({ error: "响应未确认", code: "RESULT_UNKNOWN", uncertain: true, eventId: "event-1", result: { name: "工具" } }, { status: 502 }));
  const api = { config: { clientUrl: "http://127.0.0.1:6000", serverUrl: "https://server.invalid", token: "caller-session" } };
  await assert.rejects(dispatch(parseArguments(["skill-start", "工具"]), api), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.code, "RESULT_UNKNOWN");
    assert.equal(error.uncertain, true);
    assert.equal(error.eventId, "event-1");
    assert.deepEqual(error.result, { name: "工具" });
    return true;
  });
});

test("Skill CLI发现服务器或配置目录不匹配时不会发出委派请求", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json({ csrfToken: "host", serverUrl: "https://other.invalid", connectionKey: "other" }); });
  const api = { config: { clientUrl: "http://127.0.0.1:6000", serverUrl: "https://server.invalid", token: "independent-agent" } };
  await assert.rejects(dispatch(parseArguments(["skill-start", "工具"]), api), { code: "LOCAL_CLIENT_MISMATCH" });
  assert.equal(requests, 1);
});

test("未登录 CLI 不会借用已打开的工作台身份", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("cannot request host"); });
  const api = { config: { clientUrl: "http://127.0.0.1:6000", serverUrl: "https://server.invalid", token: "" } };
  await assert.rejects(dispatch(parseArguments(["skill-start", "工具"]), api), { status: 401, code: "LOCAL_LOGIN_REQUIRED" });
  assert.equal(requests, 0);
});

test("显式转换使用统一skill接口和原token，不把非法runtime静默当skill", async () => {
  const calls = [];
  const api = new ApiClient({ serverUrl: "http://server.invalid", token: "private-token" }, async (url, init) => {
    calls.push({ url: new URL(url), method: init.method, body: JSON.parse(init.body) });
    return Response.json({ name: "旧代码", runtime: { engine: "node", entry: "scripts/cli.mjs" }, token: "converted", eventId: "conversion" });
  });
  await dispatch(parseArguments(["convert-skill", "旧代码", "--token", "old-version"]), api);
  await performAction(api, { action: "convert-skill", name: "旧代码", token: "old-version" });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(decodeURIComponent(call.url.pathname), "/api/capsules/旧代码/skill");
    assert.equal(call.method, "POST");
    assert.deepEqual(call.body, { token: "old-version" });
  }
});
