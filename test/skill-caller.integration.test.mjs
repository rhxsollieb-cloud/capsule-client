import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../src/api/client.mjs";
import { Authentication, configuredConnection } from "../src/operations/auth.mjs";
import { adminOperation } from "../src/operations/admin.mjs";
import { SkillManager } from "../src/skills/manager.mjs";
import { localSkillAction } from "../src/skills/local-client.mjs";
import { createUiApplication } from "../src/ui/application.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

const uiSource = `import { createServer } from "node:http";
import { writeSync } from "node:fs";
const server = createServer((_request, response) => response.end("caller skill"));
server.listen(0, "127.0.0.1", () => writeSync(3, JSON.stringify({ url: "http://127.0.0.1:" + server.address().port + "/" }) + "\\n"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;

test("CLI当前登录会话独立授权Skill，不能借本机身份访问保护cap或绕过撤销", { skip: missingServer, timeout: 90000 }, async (t) => {
  const { application, clientHome } = await serverFixture(t);
  const admin = new ApiClient({ serverUrl: application.url, token: "integration-only-token", home: clientHome });
  const user = await adminOperation(admin, "user-create", { name: "协作员工", role: "editor", username: "skill.employee", password: "skill-password-1234" });
  const env = { CAPSULE_CLIENT_HOME: clientHome, CAPSULE_SERVER_URL: application.url };
  const authentication = new Authentication({ env });
  const login = await authentication.login({ username: "skill.employee", password: "skill-password-1234" });
  let ordinary = await application.capsules.create({ name: "普通协作工具", kind: "code" });
  ordinary = await application.capsules.write(ordinary.name, { token: ordinary.token, entry: "scripts/ui.mjs", body: uiSource });
  const protectedCap = await application.capsules.create({ name: "管理员保护工具", kind: "code" });
  const access = await adminOperation(admin, "cap-access", { name: protectedCap.name });
  await adminOperation(admin, "cap-access", { name: protectedCap.name, revision: access.revision, permission: "none" });
  // The bridge itself is signed out; the CLI supplies its current login session.
  const hostConfig = { serverUrl: application.url, home: clientHome, token: "" };
  const host = new SkillManager(new ApiClient(hostConfig));
  const ui = createUiApplication({ config: hostConfig, skills: host, port: 0 });
  await ui.start(); t.after(() => ui.close());
  const caller = { ...configuredConnection(env), clientUrl: ui.url };
  assert.equal((await ui.authentication.status()).authenticated, false);
  const localSession = await (await fetch(ui.url + "/ui/session")).json();
  const noCaller = await fetch(ui.url + "/ui/action", { method: "POST",
    headers: { "Content-Type": "application/json", "X-Capsule-Session": localSession.csrfToken, "X-Capsule-Server": application.url, "X-Capsule-Connection": localSession.connectionKey },
    body: JSON.stringify({ action: "skill-start", name: ordinary.name }),
  });
  assert.equal(noCaller.status, 401);
  assert.equal((await noCaller.json()).code, "LOCAL_LOGIN_REQUIRED");
  assert.equal(host.sessions.has(ordinary.name), false);
  await assert.rejects(localSkillAction(caller, "skill-register", protectedCap.name), { status: 404 });
  assert.equal(host.sessions.has(protectedCap.name), false);
  const started = await localSkillAction(caller, "skill-start", ordinary.name);
  assert.equal(started.state, "running");
  assert.equal(await (await fetch(started.session.url)).text(), "caller skill");
  assert.equal(host.sessions.has(ordinary.name), true);
  const credentials = await adminOperation(admin, "credentials", { userId: user.user.id });
  const session = credentials.items.find((item) => item.id === login.principal.credentialId);
  assert.equal(session.kind, "session");
  await adminOperation(admin, "credential-revoke", { id: session.id, revision: session.revision });
  await assert.rejects(localSkillAction(caller, "skill-status", ordinary.name), { status: 401 });
  await assert.rejects(localSkillAction(caller, "skill-stop", ordinary.name), { status: 401 });
  // A separately authenticated maintainer can stop the shared local session.
  const stopped = await localSkillAction({ ...caller, token: "integration-only-token" }, "skill-stop", ordinary.name);
  assert.equal(stopped.state, "stopped");
  await assert.rejects(fetch(started.session.url, { signal: AbortSignal.timeout(1500) }));
});
