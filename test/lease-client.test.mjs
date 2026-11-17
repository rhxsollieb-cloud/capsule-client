import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { leasedApi, leaseOperation } from "../src/operations/leases.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { main } from "../src/cli.mjs";
import { skillEnvironment } from "../src/skills/environment.mjs";

test("proof只附受保护写，不进入读取、SQL查询、列表或全局api实例", async () => {
  const calls = [];
  const api = new ApiClient({ serverUrl: "http://server.invalid", token: "personal" }, async (url, options) => { calls.push({ url, options }); return Response.json({ ok: true }); });
  const scoped = leasedApi(api, "lease-private");
  for (const [path, method] of [["/api/capsules/test", "GET"], ["/api/capsules/test/query", "POST"], ["/api/capsules/test/content", "GET"], ["/api/capsules", "POST"]]) await scoped.json(path, method);
  assert.equal(calls.every((call) => !call.options.headers.has("X-Capsule-Lease")), true);
  for (const [path, method] of [["/api/capsules/test", "PATCH"], ["/api/capsules/test/write", "POST"], ["/api/capsules/test/content", "PUT"], ["/api/office/sessions", "POST"], ["/api/office/sessions/session-id/save", "POST"]]) await scoped.json(path, method);
  assert.equal(calls.slice(4).every((call) => call.options.headers.get("X-Capsule-Lease") === "lease-private"), true);
  assert.equal(api.leaseProof, undefined);
  assert.equal(scoped.redact("lease-private personal"), "[凭据已隐藏] [凭据已隐藏]");
});

test("租约协议校验参数，续租proof走header，CLI写支持--lease且读取拒绝该参数", async () => {
  const calls = [];
  const api = { path: (_name, method) => "/" + method, json: (...args) => { calls.push(args); return {}; } };
  const id = "501ceaea-0760-4695-bb27-3ac3601f73f0";
  await leaseOperation(api, "lease-renew", { name: "说明", id, lease: "secret" });
  assert.deepEqual(calls[0], ["/lease", "PATCH", { id }, { "X-Capsule-Lease": "secret" }]);
  await assert.rejects(leaseOperation(api, "lease-acquire", { name: "说明", id: "bad", scope: "content" }), /UUID/);
  assert.equal(parseArguments(["update", "说明", "--description", "新", "--token", "version", "--lease", "secret"]).values.lease, "secret");
  assert.throws(() => parseArguments(["read", "说明", "--lease", "secret"]), /不支持/);
  assert.equal(parseArguments(["lease-acquire", "说明", "--id", id, "--scope", "content"]).command, "lease-acquire");
});

test("CLI租约环境值仅供写调用，错误不泄露proof，任意Skill环境剔除proof", async (t) => {
  const previous = process.env.CAPSULE_LEASE_TOKEN;
  process.env.CAPSULE_LEASE_TOKEN = "host-private-lease";
  t.after(() => { if (previous === undefined) delete process.env.CAPSULE_LEASE_TOKEN; else process.env.CAPSULE_LEASE_TOKEN = previous; });
  assert.equal(Object.hasOwn(skillEnvironment(), "CAPSULE_LEASE_TOKEN"), false);
  assert.equal(Object.hasOwn(skillEnvironment({ CAPSULE_LEASE_TOKEN: "explicit-private" }), "CAPSULE_LEASE_TOKEN"), false);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls.push(options);
    return Response.json({ error: "denied cli-private-lease", code: "EDIT_LEASE_LOST" }, { status: 409 });
  });
  const env = { CAPSULE_SERVER_URL: "http://server.invalid", CAPSULE_LEASE_TOKEN: "cli-private-lease" };
  const output = { stdout: "", stderr: "" }, io = { stdout: { write: (v) => { output.stdout += v; } }, stderr: { write: (v) => { output.stderr += v; } } };
  assert.equal(await main(["update", "说明", "--description", "新", "--token", "version", "--json-errors"], env, io), 1);
  assert.equal(calls[0].headers.get("X-Capsule-Lease"), "cli-private-lease");
  assert.equal(JSON.stringify(output).includes("cli-private-lease"), false);
  await main(["stat", "说明"], env, io);
  assert.equal(calls[1].headers.has("X-Capsule-Lease"), false);
  await main(["office-open", "说明.docx", "--token", "read-version", "--mode", "view"], env, io);
  assert.equal(calls[2].headers.has("X-Capsule-Lease"), false);
});
