import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ApiClient } from "../src/api/client.mjs";
import { createUiApplication } from "../src/ui/application.mjs";

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "capsule-ui-"));
  const webRoot = join(directory, "web");
  await mkdir(webRoot);
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Cap UI</title>");
  await writeFile(join(webRoot, "app.mjs"), "export const ready = true;\n");
  const config = { home: join(directory, "client"), serverUrl: "http://backend.invalid", token: "test-private-token" };
  const calls = [];
  const original = Buffer.from([0, 255, 128, 10, 32]);
  const api = new ApiClient(config, async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.headers.get("Authorization"), "Bearer test-private-token");
    const path = new URL(url).pathname;
    if (path === "/api/health") return Response.json({ status: "ok", apiVersion: 3 });
    if (path.endsWith("/write")) {
      const body = JSON.parse(init.body);
      if (body.token === "old")
        return Response.json({ error: "版本冲突 test-private-token", code: "CONFLICT", eventId: "receipt" }, { status: 409 });
      return Response.json({ name: "文档.txt", commit: "updated", token: "new" });
    }
    if (path.endsWith("/content") && init.method === "PUT") {
      const chunks = [];
      for await (const chunk of init.body) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), original);
      assert.equal(init.headers.get("If-Match"), "current");
      return Response.json({ commit: "uploaded", token: "next" });
    }
    if (path.endsWith("/content")) {
      if (init.headers.get("Range") === "bytes=1-3")
        return new Response(original.subarray(1, 4), { status: 206, headers: {
          "Content-Range": "bytes 1-3/5", "Content-Length": "3", "Accept-Ranges": "bytes",
        } });
      return new Response(original, { headers: { "Content-Length": "5" } });
    }
    throw new Error("Unexpected backend request " + path);
  });
  const app = createUiApplication({ config, api, webRoot, port: 0, ...options });
  await app.start();
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const session = await (await fetch(app.url + "/ui/session")).json();
  const action = (body, headers = {}) => fetch(app.url + "/ui/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Capsule-Session": session.csrfToken, ...headers },
    body: JSON.stringify(body),
  });
  return { directory, config, webRoot, app, api, calls, original, session, action };
}

test("本地界面提供静态模块和会话，凭据留在客户端", async (t) => {
  const { app, session, calls, webRoot, directory } = await fixture(t);
  const page = await fetch(app.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Cap UI/);
  assert.match(page.headers.get("Content-Security-Policy"), /script-src 'self'/);
  assert.equal(session.serverUrl, "http://backend.invalid");
  assert.equal(typeof session.csrfToken, "string");
  assert.equal(JSON.stringify(session).includes("test-private-token"), false);
  assert.equal(calls.length, 0);
  const script = await fetch(app.url + "/app.mjs");
  assert.match(script.headers.get("Content-Type"), /javascript/);
  const head = await fetch(app.url + "/app.mjs", { method: "HEAD" });
  assert.equal(await head.text(), "");
  await writeFile(join(directory, "secret.mjs"), "private");
  await symlink(join(directory, "secret.mjs"), join(webRoot, "linked.mjs"));
  assert.equal((await fetch(app.url + "/linked.mjs")).status, 403);
  assert.equal((await fetch(app.url + "/%2e%2e%2fsecret.mjs")).status, 403);
});

test("操作验证CSRF、Origin和Host后才调用共享客户端", async (t) => {
  const { app, action, calls } = await fixture(t);
  assert.equal((await action({ action: "health" }, { "X-Capsule-Session": "wrong" })).status, 403);
  assert.equal((await action({ action: "health" }, { Origin: "https://untrusted.invalid" })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(app.url + "/ui/session", { headers: { Host: "untrusted.invalid" } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(status, 403);
  assert.equal(calls.length, 0);
  const accepted = await action({ action: "health" }, { Origin: app.url });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).apiVersion, 3);
  assert.equal(calls.length, 1);
  assert.equal((await action({ action: "health", arbitrary: true })).status, 400);
  assert.equal((await action({ action: "constructor" })).status, 400);
  assert.equal((await action({ action: "toString" })).status, 400);
  const crossSite = await fetch(app.url + "/ui/content?name=私有.jpg", {
    headers: { "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(crossSite.status, 403);
  assert.equal(calls.length, 1);
});

test("文本保存透传原版本冲突和事件ID，保留输入且不重放", async (t) => {
  const { action, calls } = await fixture(t);
  const response = await action({ action: "save", name: "文档.txt", body: "未提交草稿", token: "old" });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "版本冲突 [凭据已隐藏]", code: "CONFLICT", eventId: "receipt",
  });
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].init.body).body, "未提交草稿");
  const saved = await action({ action: "save", name: "文档.txt", body: "新的正文", token: "current" });
  assert.equal((await saved.json()).commit, "updated");
});

test("媒体通过共享客户端流式上传与Range读取，暂存清空", async (t) => {
  const { app, session, original, config } = await fixture(t);
  const partial = await fetch(app.url + "/ui/content?name=原件.jpg", { headers: { Range: "bytes=1-3", "X-Capsule-Session": session.csrfToken } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("Content-Range"), "bytes 1-3/5");
  assert.equal(partial.headers.get("Content-Type"), "image/jpeg");
  assert.equal(partial.headers.get("Authorization"), null);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), original.subarray(1, 4));
  const unsafe = await fetch(app.url + "/ui/content?name=原件.html&session=" + session.csrfToken);
  assert.match(unsafe.headers.get("Content-Disposition"), /^attachment/);
  await unsafe.arrayBuffer();
  const uploaded = await fetch(app.url + "/ui/upload?name=原件.jpg", {
    method: "PUT",
    headers: { "X-Capsule-Session": session.csrfToken, "If-Match": "current" },
    body: original,
  });
  assert.equal(uploaded.status, 200);
  assert.equal((await uploaded.json()).commit, "uploaded");
  assert.deepEqual(await readdir(join(config.home, "uploads")), []);
});

test("分块上传超限返回413并清理临时文件", async (t) => {
  const { app, session, calls, config } = await fixture(t, { maxUploadBytes: 4 });
  const response = await fetch(app.url + "/ui/upload?name=原件.jpg", {
    method: "PUT",
    headers: { "X-Capsule-Session": session.csrfToken, "If-Match": "current" },
    body: Readable.from([Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])]),
    duplex: "half",
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /超过/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await readdir(join(config.home, "uploads")), []);
  const files = await readdir(config.home);
  assert.equal(files.includes("test-private-token"), false);
});
