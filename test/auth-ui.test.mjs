import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Authentication } from "../src/operations/auth.mjs";
import { createUiApplication } from "../src/ui/application.mjs";
import { main } from "../src/cli.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "capsule auth UI "));
  const env = { CAPSULE_CONFIG_HOME: join(directory, "profile"), CAPSULE_CLIENT_HOME: join(directory, "cache"), CAPSULE_SERVER_URL: "http://127.0.0.1:5998" };
  const calls = [];
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith("/login")) {
      const input = JSON.parse(init.body);
      return Response.json({ token: "private-session-" + input.username, expiresAt: "2099-01-01T00:00:00.000Z", principal: { id: input.username, username: input.username, role: "editor" } });
    }
    if (path.endsWith("/me")) {
      const token = init.headers.get("Authorization");
      if (!token) return Response.json({ error: "需要登录" }, { status: 401 });
      return Response.json({ principal: { id: token.replace("Bearer private-session-", ""), role: "editor" } });
    }
    if (path.endsWith("/logout")) return Response.json({ loggedOut: true });
    throw new Error("Unexpected request " + path);
  };
  const authentication = new Authentication({ env, fetcher });
  const app = createUiApplication({ config: authentication.config, authentication, api: authentication.api(), port: 0 });
  await app.start();
  authentication.config.clientUrl = app.url;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
  const session = async () => (await fetch(app.url + "/ui/session")).json();
  const post = async (operation, input, csrf) => fetch(app.url + "/ui/auth/" + operation, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: app.url, "X-Capsule-Session": csrf }, body: JSON.stringify(input),
  });
  return { app, authentication, env, calls, session, post };
}

test("未登录即可连接，登录留在本机并轮换 CSRF，原会话不能继续写入", async (t) => {
  const { app, authentication, session, post, calls } = await fixture(t);
  const first = await session();
  assert.equal(first.connectionKey, authentication.store.key);
  assert.equal((await post("login", { username: "employee", password: "test-password-1234" }, "bad")).status, 403);
  assert.equal(calls.length, 0);
  const status = await (await fetch(app.url + "/ui/auth/status")).json();
  assert.equal(status.connected, true); assert.equal(status.authenticated, false);
  const response = await post("login", { username: "employee", password: "test-password-1234" }, first.csrfToken);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.principal.id, "employee");
  assert.equal(JSON.stringify(result).includes("private-session"), false);
  assert.notEqual((await session()).csrfToken, first.csrfToken);
  assert.equal((await post("logout", {}, first.csrfToken)).status, 403);
  const identity = await (await fetch(app.url + "/ui/auth/status")).json();
  assert.equal(identity.principal.id, "employee");
  const renewed = await session();
  assert.equal((await post("login", { username: "different", password: "test-password-1234", expectedUserId: "employee" }, renewed.csrfToken)).status, 409);
  assert.equal((await session()).csrfToken, renewed.csrfToken);
  assert.equal(authentication.config.token, "private-session-employee");
});

test("CLI 登录复用同 profile 的本机 BFF，与已打开工作台共享身份", async (t) => {
  const { app, authentication, env, session, calls } = await fixture(t);
  const previousSession = await session();
  let stdout = "", stderr = "";
  const input = Readable.from(["test-password-1234\n"]);
  const code = await main(["login", "employee", "--password-file", "-"], { ...env, CAPSULE_CLIENT_URL: app.url, CAPSULE_TOKEN: "independent-agent" }, {
    stdin: input, stdout: { write: (value) => { stdout += value; } }, stderr: { write: (value) => { stderr += value; } },
  });
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).principal.id, "employee");
  assert.equal(stdout.includes("private-session"), false);
  assert.equal(authentication.config.token, "private-session-employee");
  assert.equal(authentication.store.read().clientUrl, app.url);
  const requestCount = calls.length;
  for (const path of ["/ui/content?name=private.jpg", "/ui/office/recovery?id=test", "/ui/admin/backup-content?id=test"])
    assert.equal((await fetch(app.url + path + "&session=" + previousSession.csrfToken)).status, 403);
  assert.equal(calls.length, requestCount, "旧页面的媒体/恢复/备份链接不能以新身份请求服务端");
  const status = await (await fetch(app.url + "/ui/auth/status")).json();
  assert.equal(status.principal.id, "employee");
});

test("远端退出成功而本机配置写入失败仍轮换 CSRF，旧页面不能继续访问", async (t) => {
  const { authentication, session, post, app } = await fixture(t);
  const first = await session();
  assert.equal((await post("login", { username: "employee", password: "test-password-1234" }, first.csrfToken)).status, 200);
  const before = await session();
  t.mock.method(authentication.store, "write", () => { throw new Error("disk full"); });
  const loggedOut = await post("logout", {}, before.csrfToken);
  assert.equal(loggedOut.status, 500);
  const receipt = await loggedOut.json();
  assert.equal(receipt.code, "AUTH_LOCAL_PUBLISH_FAILED");
  assert.equal(receipt.result.loggedOut, true);
  assert.equal(authentication.config.token, "");
  assert.notEqual((await session()).csrfToken, before.csrfToken);
  assert.equal((await fetch(app.url + "/ui/content?name=private.png&session=" + before.csrfToken)).status, 403);
});
