import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { revalidatedContent } from "../src/cache/content.mjs";
import { ContentCache } from "../src/cache/content-store.mjs";
import { withCacheLock } from "../src/cache/lock.mjs";
import { withClientDatabase } from "../src/storage/database.mjs";
import { sendMedia } from "../src/ui/media.mjs";
import { sendOfficeRecovery } from "../src/ui/office.mjs";
import { browserReadSignal, BROWSER_READ_TIMEOUT_MS } from "../src/ui/read-signal.mjs";

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function until(check) {
  const deadline = Date.now() + 3000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error("隔离读取取消测试等待超时");
    await delay(5);
  }
}

async function fixture(t, recovery = false) {
  const home = await mkdtemp(join(tmpdir(), "capsule-read-cancel-"));
  const bytes = Buffer.alloc(1024 * 1024, 7);
  const etag = '"' + createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") + '"';
  const started = deferred(), release = deferred(), upstreamClosed = deferred(), operationDone = deferred();
  const state = { sent: 0, transfers: 0, requests: 0 };
  const upstream = createServer(async (request, response) => {
    state.requests++;
    if (request.headers["if-none-match"] === etag) { response.writeHead(304, { ETag: etag }); response.end(); return; }
    state.transfers++;
    response.once("close", () => upstreamClosed.resolve());
    response.writeHead(200, { "Content-Length": bytes.length, ETag: etag });
    response.write(bytes.subarray(0, 65536)); state.sent += 65536; started.resolve();
    await release.promise;
    if (!response.destroyed) { state.sent += bytes.length - 65536; response.end(bytes.subarray(65536)); }
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const config = { home, serverUrl: `http://127.0.0.1:${upstream.address().port}` };
  const api = new ApiClient(config);
  const bridge = createServer((request, response) => {
    const operation = recovery ? sendOfficeRecovery(response, new URL("http://localhost/?id=00000000-0000-4000-8000-000000000000"), api, request)
      : sendMedia(request, response, new URL("http://localhost/?name=test.jpg"), api);
    operation.catch((error) => { state.error = error; if (!response.destroyed) response.destroy(); }).finally(operationDone.resolve);
  });
  bridge.listen(0, "127.0.0.1"); await once(bridge, "listening");
  t.after(async () => {
    release.resolve(); bridge.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise((resolve) => bridge.close(resolve)), new Promise((resolve) => upstream.close(resolve))]);
    await rm(home, { recursive: true, force: true });
  });
  return { home, bytes, api, state, started, release, upstreamClosed, operationDone, url: `http://127.0.0.1:${bridge.address().port}` };
}

function browser(url) {
  const request = httpRequest(url);
  request.on("error", () => {});
  request.end();
  return request;
}

test("正常GET请求close和完成响应不误取消，断连/超时生效且dispose移除监听", async () => {
  const request = new EventEmitter(), response = new EventEmitter();
  const read = browserReadSignal(request, response, { timeoutMs: 1000 });
  request.emit("close"); assert.equal(read.signal.aborted, false);
  response.writableFinished = true; response.emit("close"); assert.equal(read.signal.aborted, false);
  request.emit("aborted"); assert.equal(read.signal.aborted, true);
  read.dispose(); assert.equal(request.listenerCount("aborted"), 0); assert.equal(response.listenerCount("close"), 0);
  const timed = browserReadSignal(undefined, new EventEmitter(), { timeoutMs: 10 });
  await delay(25); assert.equal(timed.signal.reason.name, "TimeoutError"); timed.dispose();
  const disposed = browserReadSignal(undefined, new EventEmitter(), { timeoutMs: 10 });
  disposed.dispose(); await delay(25); assert.equal(disposed.signal.aborted, false);
});

test("浏览器在小媒体预读阶段断连会停止上游且不发布半份缓存", { timeout: 10000 }, async (t) => {
  const value = await fixture(t);
  const request = browser(value.url);
  await value.started.promise;
  request.destroy();
  await value.upstreamClosed.promise;
  await value.operationDone.promise;
  assert.ok(value.state.sent < value.bytes.length);
  const count = await withClientDatabase(value.home, (db) => db.prepare("SELECT count(*) AS n FROM content_cache").get().n);
  assert.equal(count, 0);
  assert.deepEqual(await readdir(join(value.home, "content-cache", "files")), []);
  assert.deepEqual(await readdir(join(value.home, "content-cache", "locks")), []);
});

test("取消等待缓存锁的读者不影响下载者，完整合法缓存仍供后续304复用", { timeout: 10000 }, async (t) => {
  const value = await fixture(t);
  const active = revalidatedContent(value.api, "test.jpg");
  await value.started.promise;
  const controller = new AbortController();
  const waiting = revalidatedContent(value.api, "test.jpg", undefined, { signal: controller.signal });
  const rejected = assert.rejects(waiting, { name: "AbortError" });
  await until(async () => (await readdir(join(value.home, "content-cache", "locks"))).filter((name) => name.endsWith(".claim")).length >= 2);
  controller.abort(); await rejected;
  assert.equal(value.state.requests, 1);
  value.release.resolve();
  const complete = await active;
  assert.deepEqual(Buffer.from(await complete.response.arrayBuffer()), value.bytes);
  const reused = await revalidatedContent(value.api, "test.jpg");
  assert.equal(reused.cacheHit, true);
  assert.deepEqual(Buffer.from(await reused.response.arrayBuffer()), value.bytes);
  assert.equal(value.state.transfers, 1); assert.equal(value.state.requests, 2);
});

test("完整字节等待索引锁时取消不再发布，锁claim清理且其他持有者不受影响", async (t) => {
  const value = await fixture(t);
  const cache = new ContentCache(value.api.config), held = deferred(), release = deferred();
  await cache.prepare();
  const owner = withCacheLock(join(cache.root, "index.lock"), async () => { held.resolve(); await release.promise; });
  await held.promise;
  const controller = new AbortController();
  const etag = '"' + createHash("sha1").update(`blob ${value.bytes.length}\0`).update(value.bytes).digest("hex") + '"';
  const pending = cache.publish(cache.identity("test.jpg"), value.bytes, etag, { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  try {
    await until(async () => (await readdir(cache.root)).filter((name) => name.startsWith("index.lock.") && name.endsWith(".claim")).length >= 2);
    controller.abort(); await rejected;
    assert.deepEqual(await readdir(cache.files), []);
  } finally { release.resolve(); await owner; }
  assert.equal((await readdir(cache.root)).some((name) => name.endsWith(".claim") || name === "index.lock"), false);
});

test("下载者取消仅释放自己的读取，下一读者完成后取消也保留已发布缓存", { timeout: 10000 }, async (t) => {
  const value = await fixture(t), first = new AbortController(), second = new AbortController();
  const active = revalidatedContent(value.api, "test.jpg", undefined, { signal: first.signal });
  const rejected = assert.rejects(active);
  await value.started.promise;
  const waiting = revalidatedContent(value.api, "test.jpg", undefined, { signal: second.signal });
  first.abort(); await rejected;
  await until(() => value.state.requests === 2);
  value.release.resolve();
  const complete = await waiting;
  assert.equal(complete.cached, true);
  second.abort(); // This reader has not consumed its buffered response yet.
  const reused = await revalidatedContent(value.api, "test.jpg");
  assert.equal(reused.cacheHit, true);
  assert.deepEqual(Buffer.from(await reused.response.arrayBuffer()), value.bytes);
  await complete.response.body.cancel();
});

test("Office恢复下载使用30分钟信号，浏览器断连停止流式原件", { timeout: 10000 }, async (t) => {
  const deadlines = [], schedule = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds, ...args) => {
    deadlines.push(milliseconds); return schedule(callback, milliseconds, ...args);
  });
  const value = await fixture(t, true);
  const request = browser(value.url);
  const response = await once(request, "response");
  const received = response[0]; received.on("error", () => {});
  await once(received, "data");
  request.destroy(); received.destroy();
  await value.upstreamClosed.promise; await value.operationDone.promise;
  assert.ok(value.state.sent < value.bytes.length);
  assert.equal(BROWSER_READ_TIMEOUT_MS, 30 * 60 * 1000);
  assert.ok(deadlines.includes(BROWSER_READ_TIMEOUT_MS));
  assert.equal(deadlines.includes(30000), false, "恢复下载不能沿用JSON默认30秒超时");
});

test("Office恢复正常传输完成，GET正常结束不会误判为取消", async () => {
  const api = new ApiClient({ serverUrl: "http://recovery.invalid" }, async (_url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    return new Response("complete", { headers: { "Content-Length": "8" } });
  });
  const response = new PassThrough(); response.writeHead = () => response;
  const chunks = []; response.on("data", (chunk) => chunks.push(chunk));
  await sendOfficeRecovery(response, new URL("http://localhost/?id=00000000-0000-4000-8000-000000000000"), api);
  assert.equal(Buffer.concat(chunks).toString(), "complete");
});
