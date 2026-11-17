import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { leaseOperation } from "../src/operations/leases.mjs";
import { createUiApplication } from "../src/ui/application.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

test("真实CLI租约阻挡无proof写，旧release不释放新占用，原token仍防覆盖", { skip: missingServer, timeout: 60000 }, async (t) => {
  const { cli } = await serverFixture(t);
  let cap = await cli("create", "租约说明.txt");
  const firstId = randomUUID(), nextId = randomUUID();
  const first = await cli("lease-acquire", cap.name, "--id", firstId, "--scope", "content");
  assert.equal(typeof first.lease.token, "string");
  assert.equal(JSON.stringify(await cli("lease-status", cap.name)).includes(first.lease.token), false);
  await assert.rejects(cli("update", cap.name, "--description", "无占用不能写", "--token", cap.token, "--json-errors"), (error) => {
    const value = JSON.parse(error.stdout);
    assert.equal(value.error.code, "EDIT_BUSY"); assert.equal(value.error.status, 423); assert.ok(value.leases[0].owner.name); return true;
  });
  const renewed = await cli("lease-renew", cap.name, "--id", firstId, "--lease", first.lease.token);
  assert.equal(renewed.lease.id, firstId);
  const oldToken = cap.token;
  cap = await cli("update", cap.name, "--description", "由占用者保存", "--token", cap.token, "--lease", first.lease.token);
  await assert.rejects(cli("update", cap.name, "--description", "旧版本覆盖", "--token", oldToken, "--lease", first.lease.token, "--json-errors"), (error) => JSON.parse(error.stdout).error.code === "VERSION_CONFLICT");
  await cli("lease-release", cap.name, "--id", firstId, "--lease", first.lease.token);
  const next = await cli("lease-acquire", cap.name, "--id", nextId, "--scope", "details");
  await cli("lease-release", cap.name, "--id", firstId);
  assert.equal((await cli("lease-status", cap.name)).leases[0].id, nextId);
  await assert.rejects(cli("update", cap.name, "--description", "旧凭证", "--token", cap.token, "--lease", first.lease.token, "--json-errors"), (error) => JSON.parse(error.stdout).error.code === "EDIT_LEASE_LOST");
  cap = await cli("update", cap.name, "--description", "新占用者保存", "--token", cap.token, "--lease", next.lease.token);
  assert.equal(cap.description, "新占用者保存");
  await cli("lease-release", cap.name, "--id", nextId);
  assert.deepEqual((await cli("lease-status", cap.name)).leases, []);
});

test("真实BFF与CLI共用租约协议，取消先于获取留tombstone，header保护写且查询不受影响", { skip: missingServer, timeout: 60000 }, async (t) => {
  const { application, clientHome, cli } = await serverFixture(t);
  const config = { serverUrl: application.url, token: "integration-only-token", home: join(clientHome, "ui") };
  const api = new ApiClient(config);
  const ui = createUiApplication({ config, api, port: 0 }); await ui.start();
  t.after(() => ui.close());
  const session = await fetch(ui.url + "/ui/session").then((response) => response.json());
  const call = async (action, value, proof) => {
    const response = await fetch(ui.url + "/ui/action", { method: "POST", headers: { Origin: ui.url, "Content-Type": "application/json", "X-Capsule-Session": session.csrfToken, ...(proof ? { "X-Capsule-Lease": proof } : {}) }, body: JSON.stringify({ action, ...value }) });
    return { status: response.status, value: await response.json() };
  };
  const cap = await cli("create", "桥接租约.txt");
  const canceled = randomUUID();
  await call("lease-release", { name: cap.name, id: canceled });
  assert.equal((await call("lease-acquire", { name: cap.name, id: canceled, scope: "content" })).value.code, "EDIT_LEASE_LOST");
  const id = randomUUID();
  const attempts = await Promise.all([call("lease-acquire", { name: cap.name, id, scope: "content" }), leaseOperation(api, "lease-acquire", { name: cap.name, id: randomUUID(), scope: "content" }).then((value) => ({ status: 200, value }), (error) => ({ status: error.status, value: error }))]);
  assert.equal(attempts.filter((item) => item.status === 200).length, 1);
  assert.equal(attempts.filter((item) => item.status === 423).length, 1);
  const winner = attempts.find((item) => item.status === 200).value.lease;
  const refused = await call("save", { name: cap.name, token: cap.token, body: "无proof" });
  assert.equal(refused.status, 423); assert.ok(refused.value.leases[0].owner.name);
  assert.equal((await call("read", { name: cap.name })).status, 200);
  const saved = await call("save", { name: cap.name, token: cap.token, body: "已持占用保存" }, winner.token);
  assert.equal(saved.status, 200);
  assert.notEqual(saved.value.token, cap.token);
  await call("lease-release", { name: cap.name, id: winner.id }, winner.token);
  assert.deepEqual((await cli("lease-status", cap.name)).leases, []);
});
