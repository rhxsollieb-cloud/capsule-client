import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { skillEnvironment } from "../src/skills/environment.mjs";

test("API调用不跟随服务端重定向或向重定向地址发出第二次写入", async () => {
  const requests = [];
  const api = new ApiClient({ serverUrl: "http://server.local", token: "secret" }, async (url, options) => {
    requests.push({ url, options });
    return new Response(null, { status: 307, headers: { Location: "https://other.invalid/api" } });
  });
  await assert.rejects(api.json("/api/capsules", "POST", { name: "test" }), { code: "SERVER_REDIRECT", status: 502 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.redirect, "manual");
});

test("CLI与UI共用运行环境边界，宿主凭据不能从覆盖参数重新传入", () => {
  const env = skillEnvironment({ CAPSULE_TOKEN: "no", CAPSULE_ONLYOFFICE_JWT_SECRET: "no", CAPSULE_SKILL_STATE: "/state", PATH: "/tools" });
  assert.equal(env.CAPSULE_TOKEN, undefined);
  assert.equal(env.CAPSULE_ONLYOFFICE_JWT_SECRET, undefined);
  assert.equal(env.CAPSULE_SKILL_STATE, "/state");
  assert.equal(env.PATH, "/tools");
});

test("连接中断及成功后的坏JSON保留写入未知结果，而不是可重试的普通失败", async () => {
  let calls = 0;
  const config = { serverUrl: "http://server.local", token: "secret" };
  const offline = new ApiClient(config, async () => { calls++; throw new Error("connection closed secret"); });
  await assert.rejects(offline.json("/api/capsules", "POST", {}), (error) => error.code === "RESULT_UNKNOWN" && error.uncertain && !error.message.includes("secret"));
  assert.equal(calls, 1);
  const invalid = new ApiClient(config, async () => new Response("not JSON"));
  await assert.rejects(invalid.json("/api/capsules", "POST", {}), { code: "INVALID_RESPONSE", uncertain: true });
  await assert.rejects(invalid.json("/api/health"), (error) => error.code === "INVALID_RESPONSE" && !error.uncertain);
});
