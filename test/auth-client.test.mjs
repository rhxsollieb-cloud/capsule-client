import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Authentication, configuredConnection } from "../src/operations/auth.mjs";
import { ConnectionStore, normalizeConnectionPath } from "../src/connection/store.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "capsule connection 中文 "));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5 }));
  const env = { CAPSULE_CONFIG_HOME: join(directory, "profile"), CAPSULE_CLIENT_HOME: join(directory, "cache"), CAPSULE_SERVER_URL: "http://127.0.0.1:5998" };
  const state = { failure: false, nextUser: "employee", calls: [] };
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body && JSON.parse(init.body);
    state.calls.push({ path, body, token: init.headers.get("Authorization") });
    if (state.failure) throw new Error("offline");
    if (path.endsWith("/login")) {
      if (body.password === "wrong") return Response.json({ error: "用户名或密码不正确", code: "AUTH_FAILED" }, { status: 401 });
      return Response.json({ token: "session-for-" + state.nextUser, expiresAt: "2099-01-01T00:00:00.000Z", principal: { id: state.nextUser, username: state.nextUser, role: "editor" } });
    }
    if (path.endsWith("/me")) return Response.json({ principal: { id: state.nextUser, role: "editor" }, permissions: { create: true } });
    if (path.endsWith("/logout")) return Response.json({ loggedOut: true });
    if (path.endsWith("/password")) return Response.json({ changed: true });
    throw new Error("Unexpected request " + path);
  };
  const store = new ConnectionStore(env);
  const auth = new Authentication({ env, store, fetcher });
  return { directory, env, state, store, auth };
}

test("连接读取不创建目录，登录仅保存会话且不改变兼容维护环境令牌", async (t) => {
  const { auth, env, store } = await fixture(t);
  assert.equal(existsSync(store.file), false);
  const result = await auth.login({ username: "employee", password: "test-password-1234", officeEditorUrl: "https://docs.example" });
  assert.equal(result.principal.id, "employee");
  assert.equal(JSON.stringify(result).includes("session-for-employee"), false);
  assert.equal(auth.config.home, env.CAPSULE_CLIENT_HOME);
  const record = store.read();
  assert.equal(record.session.token, "session-for-employee");
  assert.equal((await readFile(store.file)).includes(Buffer.from("test-password-1234")), false);
  if (process.platform !== "win32") assert.equal((await stat(store.file)).mode & 0o777, 0o600);
  const agentEnv = { ...env, CAPSULE_TOKEN: "independent-agent", CAPSULE_SERVER_URL: "https://agent-server.example" };
  assert.equal(configuredConnection(agentEnv).token, "independent-agent");
  assert.equal(configuredConnection(agentEnv).serverUrl, "https://agent-server.example");
  assert.equal(configuredConnection(agentEnv, { human: true }).token, "session-for-employee");
  assert.equal(configuredConnection(agentEnv, { human: true }).serverUrl, env.CAPSULE_SERVER_URL);
});

test("登录失败和断网保留原连接；草稿预期身份不符时撤销临时新会话", async (t) => {
  const { auth, state, store } = await fixture(t);
  await auth.login({ username: "employee", password: "test-password-1234" });
  const original = store.read();
  await assert.rejects(auth.login({ username: "employee", password: "wrong" }), { status: 401 });
  assert.deepEqual(store.read(), original);
  state.failure = true;
  const status = await auth.status();
  assert.equal(status.authenticated, false);
  assert.equal(status.connected, false);
  await assert.rejects(auth.login({ username: "employee", password: "test-password-1234" }));
  assert.deepEqual(store.read(), original);
  state.failure = false; state.nextUser = "different-user";
  await assert.rejects(auth.login({ username: "employee", password: "test-password-1234", expectedUserId: "employee" }), { code: "AUTH_IDENTITY_CHANGED" });
  assert.deepEqual(store.read(), original);
  assert.ok(state.calls.some((call) => call.path.endsWith("/logout") && call.token === "Bearer session-for-different-user"));
});

test("改密和退出不保存密码，远程密码登录拒绝明文 HTTP", async (t) => {
  const { auth, store, state } = await fixture(t);
  await assert.rejects(auth.login({ username: "employee", password: "test-password-1234", serverUrl: "http://remote.example" }), /HTTPS/);
  assert.equal(state.calls.length, 0);
  await auth.login({ username: "employee", password: "test-password-1234" });
  assert.equal((await auth.password({ currentPassword: "test-password-1234", newPassword: "new-password-1234" })).changed, true);
  assert.equal(store.read().session, undefined);
  assert.equal(auth.config.token, "");
  assert.equal(auth.config.sessionExpiresAt, undefined);
  await auth.login({ username: "employee", password: "new-password-1234" });
  assert.equal((await auth.logout()).authenticated, false);
  assert.equal(store.read().session, undefined);
  assert.equal((await readFile(store.file)).includes(Buffer.from("new-password-1234")), false);
});

test("停止失败前不撤会话或改密，远端完成后本机保存失败明确退出且不重放", async (t) => {
  const { auth, store, state } = await fixture(t);
  await auth.login({ username: "employee", password: "test-password-1234" });
  const blocked = { beforeChange: async () => { throw new Error("still saving"); } };
  const initial = state.calls.length;
  await assert.rejects(auth.logout(blocked), /still saving/);
  await assert.rejects(auth.password({ currentPassword: "test-password-1234", newPassword: "new-password-1234" }, blocked), /still saving/);
  assert.equal(state.calls.length, initial);
  const persisted = store.read();
  t.mock.method(store, "write", () => { throw new Error("disk full"); });
  await assert.rejects(auth.password({ currentPassword: "test-password-1234", newPassword: "new-password-1234" }), (error) => {
    assert.equal(error.code, "AUTH_LOCAL_PUBLISH_FAILED");
    assert.equal(error.identityChanged, true); assert.equal(error.resultChanged, true);
    assert.equal(error.result.changed, true); assert.equal(error.result.authenticated, false);
    return true;
  });
  assert.equal(state.calls.filter((call) => call.path.endsWith("/password")).length, 1);
  assert.equal(auth.config.token, "");
  assert.deepEqual(store.read(), persisted, "磁盘写入失败不伪造持久成功，旧会话在远端已失效");
});

test("Windows 同一连接路径不同大小写、分隔符和扩展路径前缀具有相同身份", () => {
  const expected = normalizeConnectionPath("C:\\Users\\员工 A\\Capsule\\connection.sqlite", "win32");
  assert.equal(normalizeConnectionPath("c:/users/员工 A/Capsule/connection.sqlite", "win32"), expected);
  assert.equal(normalizeConnectionPath("\\\\?\\C:\\USERS\\员工 A\\Capsule\\connection.sqlite", "win32"), expected);
});

test("原生 Windows 连接文件的路径别名不会绕过同一个 BFF", { skip: process.platform !== "win32" ? "需要 Windows 原生路径" : false }, async (t) => {
  const { auth, store, env } = await fixture(t);
  await auth.login({ username: "employee", password: "test-password-1234" });
  const alias = new ConnectionStore({ ...env, CAPSULE_CONFIG_HOME: store.home.toUpperCase().replaceAll("\\", "/") });
  assert.equal(alias.key, store.key);
  assert.equal(alias.read().session.token, store.read().session.token);
});
