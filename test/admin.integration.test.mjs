import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { adminOperation } from "../src/operations/admin.mjs";
import { performAction } from "../src/ui/actions.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

test("无凭据的首次管理员通过CLI完整取得一次性凭据，之后匿名失效且个人身份可接续", { skip: missingServer, timeout: 60000 }, async (t) => {
  const { application, cli } = await serverFixture(t, { token: "" });
  assert.equal((await cli("me")).principal.kind, "development");
  const initialized = await cli("user-create", "首位管理员", "--role", "admin", "--max-chars", "2048");
  assert.equal(typeof initialized.bootstrapCredential?.token, "string");
  assert.equal(initialized.dataOmitted, undefined);
  const personal = new ApiClient({ serverUrl: application.url, token: initialized.bootstrapCredential.token });
  const identity = await adminOperation(personal, "me");
  assert.equal(identity.principal.id, initialized.user.id);
  assert.equal(identity.permissions.manage, true);
  await assert.rejects(adminOperation(new ApiClient({ serverUrl: application.url }), "me"), (error) => error.status === 401);
});

test("三档cap权限、普通员工与撤销经真实服务端在CLI和UI入口一致生效", { skip: missingServer, timeout: 90000 }, async (t) => {
  const { application, directory, cli } = await serverFixture(t);
  assert.equal((await cli("me")).principal.role, "admin");
  const cap = await cli("create", "内部说明.md", "--kind", "markdown");
  const created = await cli("user-create", "普通员工", "--role", "editor");
  const signed = await cli("credential-create", created.user.id, "--label", "集成测试客户端");
  assert.equal(typeof signed.token, "string");
  assert.equal(JSON.stringify(await cli("credentials", "--user-id", created.user.id)).includes(signed.token), false);
  const initialAccess = await cli("cap-access", cap.name);
  assert.equal(initialAccess.permission, "edit");
  const access = await cli("cap-access", cap.name, "--revision", String(initialAccess.revision), "--permission", "read");
  const reader = new ApiClient({ serverUrl: application.url, token: signed.token, home: join(directory, "employee-client") });
  assert.equal((await adminOperation(reader, "me")).permissions.create, true);
  const record = await performAction(reader, { action: "stat", name: cap.name });
  assert.equal(record.permissions.read, true);
  assert.equal(record.permissions.edit, false);
  await assert.rejects(performAction(reader, { action: "save", name: cap.name, body: "不能保存", token: record.token }), (error) => error.status === 403);
  await assert.rejects(adminOperation(reader, "users"), (error) => error.status === 403);
  const allowed = await cli("cap-access", cap.name, "--revision", String(access.revision), "--permission", "edit");
  const writable = await performAction(reader, { action: "stat", name: cap.name });
  const saved = await performAction(reader, { action: "save", name: cap.name, body: "# 已授权保存", token: writable.token });
  assert.notEqual(saved.commit, writable.commit);
  await assert.rejects(cli("cap-access", cap.name, "--revision", String(access.revision), "--permission", "none", "--json-errors"),
    (error) => JSON.parse(error.stdout).error.status === 409);
  const hidden = await cli("cap-access", cap.name, "--revision", String(allowed.revision), "--permission", "none");
  assert.equal(hidden.permission, "none");
  await assert.rejects(performAction(reader, { action: "stat", name: cap.name }), (error) => error.status === 404);
  assert.equal((await performAction(new ApiClient({ serverUrl: application.url, token: "integration-only-token" }), { action: "stat", name: cap.name })).name, cap.name);
  const audit = await cli("audit", "--name", cap.name, "--limit", "100");
  assert.ok(audit.items.some((item) => item.principal?.id === created.user.id));
  await cli("credential-revoke", signed.credential.id, "--revision", String(signed.credential.revision));
  await assert.rejects(adminOperation(reader, "me"), (error) => error.status === 401);
});

test("备份CLI贯通完整备份、归档、校验、预演及隔离恢复，不替换活动知识库", { skip: missingServer, timeout: 90000 }, async (t) => {
  const { directory, cli } = await serverFixture(t);
  const cap = await cli("create", "备份说明.txt");
  const backup = await cli("backup-create", "--label", "上线前核对");
  assert.equal(backup.status, "succeeded");
  assert.ok((await cli("backups")).items.some((item) => item.id === backup.id));
  const inspected = await cli("backup-inspect", backup.id);
  assert.equal(inspected.checksum, backup.checksum);
  assert.equal((await cli("backup-verify", backup.id)).verified, true);
  const local = join(directory, "complete-backup.tar");
  await cli("backup-download", backup.id, local);
  assert.ok((await stat(local)).size > 0);
  if (process.platform !== "win32") assert.equal((await stat(local)).mode & 0o777, 0o600);
  const preview = await cli("backup-restore-preview", backup.id);
  assert.equal(preview.isolated, true);
  const restored = await cli("backup-restore", backup.id, "--preview-id", preview.previewId, "--checksum", preview.checksum, "--confirmation-name", preview.confirmationName);
  assert.equal(restored.status, "succeeded");
  assert.equal(restored.isolated, true);
  assert.equal(restored.restoreId, preview.restoreId);
  assert.ok(restored.adjustments.includes("personal-credentials-revoked"));
  assert.equal((await cli("backup-receipt", preview.restoreId)).status, "succeeded");
  assert.equal((await cli("stat", cap.name)).commit, cap.commit);
});
