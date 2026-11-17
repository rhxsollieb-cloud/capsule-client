import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { adminOperation, backupContentPath } from "../src/operations/admin.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { dispatch, main } from "../src/cli.mjs";
import { performAction } from "../src/ui/actions.mjs";
import { createUiApplication } from "../src/ui/application.mjs";
import { readIdentity } from "../web/api.mjs";

function fixture() {
  const calls = [];
  const api = new ApiClient({ home: "/unused", serverUrl: "http://backend.invalid", token: "existing-test-token" }, async (url, init) => {
    calls.push({ path: new URL(url).pathname, query: Object.fromEntries(new URL(url).searchParams), method: init.method || "GET", body: init.body === undefined ? undefined : JSON.parse(init.body) });
    return Response.json({ result: true, status: "succeeded", isolated: true, restoreId: "restore-1" });
  });
  return { api, calls };
}

test("旧本机桥接或旧服务端缺少me时明确提示同步重启，不匿名回退也不误报正常认证失败", async (t) => {
  let calls = 0;
  let response;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: response.message }, { status: response.status }); });
  for (const [status, message] of [[400, "未知客户端操作"], [404, "接口不存在"], [401, "凭据已撤销"]]) {
    response = { status, message };
    await assert.rejects(readIdentity(), (error) => {
      if (status === 401) { assert.equal(error.message, message); assert.notEqual(error.code, "IDENTITY_API_UNAVAILABLE"); }
      else { assert.equal(error.code, "IDENTITY_API_UNAVAILABLE"); assert.match(error.message, /保存未提交内容.*同步更新并重启/); }
      return true;
    });
  }
  assert.equal(calls, 3);
});

test("管理CLI和界面复用相同操作，修订、授权与审计过滤不混用cap token或action", async () => {
  const { api, calls } = fixture();
  const cases = [
    [["me"], { action: "me" }],
    [["users", "--offset", "30"], { action: "users", offset: 30 }],
    [["user-create", "员工 / 甲", "--role", "editor", "--enabled=false"], { action: "user-create", name: "员工 / 甲", role: "editor", enabled: false }],
    [["user-update", "user-1", "--revision", "2", "--enabled=false"], { action: "user-update", id: "user-1", revision: 2, enabled: false }],
    [["credentials", "--user-id", "user-1"], { action: "credentials", userId: "user-1" }],
    [["credential-create", "user-1", "--label", "办公电脑"], { action: "credential-create", userId: "user-1", label: "办公电脑" }],
    [["credential-revoke", "key-1", "--revision", "1"], { action: "credential-revoke", id: "key-1", revision: 1 }],
    [["grants", "产品说明.md"], { action: "grants", name: "产品说明.md" }],
    [["cap-access", "产品说明.md"], { action: "cap-access", name: "产品说明.md" }],
    [["cap-access", "产品说明.md", "--revision", "7", "--permission", "read"], { action: "cap-access", name: "产品说明.md", revision: 7, permission: "read" }],
    [["cap-protect", "产品说明.md", "--revision", "8", "--protected=true"], { action: "cap-access", name: "产品说明.md", revision: 8, permission: "none" }],
    [["audit", "--action", "capsule.write", "--outcome", "success"], { action: "audit", operation: "capsule.write", outcome: "success" }],
    [["backup-create", "--label", "上线前"], { action: "backup-create", label: "上线前" }],
    [["backup-register", "backup-1", "--checksum", "sha256"], { action: "backup-register", id: "backup-1", checksum: "sha256" }],
    [["backup-restore", "backup-1", "--preview-id", "preview-1", "--checksum", "sha256", "--confirmation-name", "restore:backup-1"], { action: "backup-restore", id: "backup-1", previewId: "preview-1", checksum: "sha256", confirmationName: "restore:backup-1" }],
    [["backup-receipt", "restore-1"], { action: "backup-receipt", restoreId: "restore-1" }],
  ];
  for (const [argv, input] of cases) {
    await dispatch(parseArguments(argv), api);
    await performAction(api, input);
    assert.deepEqual(calls.at(-1), calls.at(-2), argv.join(" "));
  }
  const revoke = calls.find((call) => call.path.endsWith("/credentials/key-1"));
  assert.equal(revoke.method, "DELETE");
  assert.deepEqual(revoke.body, { revision: 1 });
  const audit = calls.find((call) => call.path === "/api/audit");
  assert.deepEqual(audit.query, { action: "capsule.write", outcome: "success" });
  assert.deepEqual(calls.at(-1), { path: "/api/backups/operations/restore-1", query: {}, method: "GET", body: undefined });
});

test("管理入口拒绝任意恢复路径和未知字段，归档ID按单段编码", async () => {
  const { api, calls } = fixture();
  await assert.rejects(adminOperation(api, "backup-restore", { id: "backup-1", target: "/active" }), /参数无效/);
  await assert.rejects(performAction(api, { action: "credential-create", userId: "user", label: "key", token: "arbitrary" }), /参数无效/);
  await assert.rejects(adminOperation(api, "cap-access", { name: "cap", revision: 1, permission: "owner" }), /permission/);
  await assert.rejects(adminOperation(api, "cap-access", { name: "cap", revision: 1 }), /permission/);
  await assert.rejects(adminOperation(api, "cap-access", { name: "cap", permission: "read" }), /revision/);
  await assert.rejects(adminOperation(api, "grant-set", { name: "cap", userId: "u", revision: 1, permission: "read" }), /未知管理操作/);
  await assert.rejects(adminOperation(api, "user-create", { name: "旧只读角色", role: "viewer" }), /admin或editor/);
  await assert.rejects(dispatch(parseArguments(["grant-set", "cap", "user", "--revision", "1", "--permission", "edit"]), api), /个人授权已停用/);
  await assert.rejects(adminOperation(api, "users", { limit: 101 }), /范围/);
  assert.equal(calls.length, 0);
  assert.equal(backupContentPath("../other"), "/api/backups/..%2Fother/content");
  assert.throws(() => backupContentPath("bad\r\nheader"), /控制字符/);
  assert.throws(() => parseArguments(["backup-restore", "id", "--target", "/active"]), /不支持/);
});

test("隔离恢复按真实回执状态判定，不把HTTP202或失败回执报成成功", async () => {
  const value = { id: "backup", previewId: "preview", checksum: "hash", confirmationName: "restore:backup" };
  for (const record of [
    { id: "restore", status: "running" },
    { id: "restore", status: "failed", error: { code: "DISK_FULL", message: "磁盘不足" } },
    { id: "restore", status: "succeeded", isolated: false, restoreId: "restore" },
  ]) {
    await assert.rejects(adminOperation({ json: async () => record }, "backup-restore", value), (error) => {
      assert.equal(error.operationId, "restore");
      assert.deepEqual(error.result, record);
      assert.equal(Boolean(error.uncertain), record.status !== "failed");
      return true;
    });
  }
});

test("一次性凭据输出不能被低预算或字段裁剪丢弃，显式输出文件仅本人可读", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-admin-output-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ credential: { id: "key-1" }, token: "issued-test-token" }); });
  const env = { CAPSULE_SERVER_URL: "http://backend.invalid" };
  const capture = () => { const value = { out: "", err: "" }; return { value, io: { stdout: { write: (text) => value.out += text }, stderr: { write: (text) => value.err += text } } }; };
  for (const flags of [["--max-chars", "512"], ["--fields", "credential"]]) {
    const output = capture();
    assert.equal(await main(["credential-create", "user-1", "--label", "办公", ...flags], env, output.io), 1);
    assert.match(output.value.err, /尚未签发/);
  }
  assert.equal(calls, 0);
  const path = join(directory, "credential.json");
  const output = capture();
  assert.equal(await main(["credential-create", "user-1", "--label", "办公", "--out", path], env, output.io), 0, output.value.err);
  assert.equal(JSON.parse(await readFile(path, "utf8")).token, "issued-test-token");
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(output.value.out.includes("issued-test-token"), false);
  assert.equal(calls, 1);
});

test("首次管理员凭据已签发但输出目录消失时，失败回执仍完整返回唯一token", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-admin-output-failure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputDirectory = join(directory, ...Array.from({ length: 5 }, (_, index) => String(index) + "long-output-path".repeat(10)));
  await mkdir(outputDirectory, { recursive: true });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++; await rm(directory, { recursive: true, force: true });
    return Response.json({ user: { id: "admin-user", name: "管理员" }, bootstrapCredential: { credential: { id: "credential", userId: "admin-user" }, token: "unique-bootstrap-test-token" } });
  });
  const output = { stdout: "", stderr: "" };
  const code = await main(["user-create", "管理员", "--role", "admin", "--out", join(outputDirectory, "credential.json"), "--max-chars", "512", "--json-errors"],
    { CAPSULE_SERVER_URL: "http://backend.invalid" }, { stdout: { write: (value) => output.stdout += value }, stderr: { write: (value) => output.stderr += value } });
  assert.equal(code, 1);
  const receipt = JSON.parse(output.stdout);
  assert.equal(receipt.error.code, "OUTPUT_WRITE_FAILED");
  assert.equal(receipt.result.token, "unique-bootstrap-test-token");
  assert.equal(receipt.result.credentialIssued, true);
  assert.equal(receipt.result.outputFailed, true);
  assert.equal(calls, 1);
});

test("本机管理桥接不向全局session泄露新旧凭据，备份归档流仍执行同源检查", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-admin-ui-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { home: directory, serverUrl: "http://backend.invalid", token: "current-test-token" };
  const api = new ApiClient(config, async (url, init) => {
    assert.equal(init.headers.get("Authorization"), "Bearer current-test-token");
    if (new URL(url).pathname.endsWith("/content")) return new Response("archive-content");
    return Response.json({ credential: { id: "key-1", enabled: true }, token: "issued-test-token" });
  });
  const app = createUiApplication({ config, api, port: 0 });
  await app.start(); t.after(() => app.close());
  const session = await (await fetch(app.url + "/ui/session")).json();
  const response = await fetch(app.url + "/ui/action", { method: "POST", headers: { "Content-Type": "application/json", "X-Capsule-Session": session.csrfToken }, body: JSON.stringify({ action: "credential-create", userId: "user-1", label: "办公" }) });
  assert.equal((await response.json()).token, "issued-test-token");
  const secondSession = await (await fetch(app.url + "/ui/session")).json();
  assert.equal(JSON.stringify(secondSession).includes("test-token"), false);
  const archive = await fetch(app.url + "/ui/admin/backup-content?id=backup-1&session=" + session.csrfToken);
  assert.equal(await archive.text(), "archive-content");
  assert.equal(archive.headers.get("Cache-Control"), "no-store");
  assert.match(archive.headers.get("Content-Disposition"), /^attachment/);
  const blocked = await fetch(app.url + "/ui/admin/backup-content?id=backup-1", { headers: { Origin: "http://foreign.invalid" } });
  assert.equal(blocked.status, 403);
});
