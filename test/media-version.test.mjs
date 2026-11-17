import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { revalidatedContent } from "../src/cache/content.mjs";
import { withClientDatabase } from "../src/storage/database.mjs";
import { sendMedia } from "../src/ui/media.mjs";

const tag = (bytes) => '"' + createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") + '"';
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "capsule-media-version-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const state = { token: "t2", bytes: Buffer.from("current image"), pulls: 0, cancelled: 0, requests: 0, statuses: [] };
  const api = new ApiClient({ home, serverUrl: "http://isolated-media.invalid" }, async (_url, init) => {
    state.requests++;
    const headers = { ETag: tag(state.bytes), "X-Capsule-Token": state.token, "Content-Length": String(state.bytes.length) };
    if (init.headers.get("If-None-Match") === headers.ETag) {
      state.statuses.push(304); return new Response(null, { status: 304, headers });
    }
    const status = init.headers.has("Range") ? 206 : 200;
    state.statuses.push(status);
    if (init.method === "HEAD") return new Response(null, { status, headers });
    return new Response(new ReadableStream({
      pull(controller) { state.pulls++; controller.enqueue(state.bytes); controller.close(); },
      cancel() { state.cancelled++; },
    }, { highWaterMark: 0 }), { status, headers });
  });
  return { home, api, state };
}

test("旧正文t1的媒体GET/Range/HEAD遇到t2在响应头阶段拒409，不读取或缓存新正文", async (t) => {
  const { home, api, state } = await fixture(t);
  const server = createServer((request, response) => sendMedia(request, response, new URL(request.url, "http://localhost"), api).catch((error) => {
    response.writeHead(error.status || 500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: error.code, error: error.message }));
  }));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/ui/content?name=image.png&version=t1`;
  for (const init of [{}, { headers: { Range: "bytes=0-3" } }, { method: "HEAD" }]) {
    const response = await fetch(url, init);
    assert.equal(response.status, 409);
    if (init.method !== "HEAD") assert.equal((await response.json()).code, "CONTENT_VERSION_CHANGED");
    else await response.arrayBuffer();
  }
  assert.equal(state.pulls, 0);
  assert.equal(state.cancelled, 2);
  assert.deepEqual(await readdir(join(home, "content-cache", "files")), []);
  const before = state.requests;
  for (const version of ["", "x".repeat(513), "bad\nvalue"]) {
    const response = await fetch(url.replace("version=t1", "version=" + encodeURIComponent(version)));
    assert.equal(response.status, 400); await response.arrayBuffer();
  }
  assert.equal(state.requests, before);
  const download = await fetch(url.replace("version=t1", "download=1"));
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), state.bytes);
});

test("304原件相同但cap元数据token已变也拒混版本，合法缓存保留并可按新token复用", async (t) => {
  const { home, api, state } = await fixture(t);
  state.token = "t1";
  const original = await revalidatedContent(api, "image.png", undefined, { expectedToken: "t1" });
  assert.deepEqual(Buffer.from(await original.response.arrayBuffer()), state.bytes);
  assert.equal(state.pulls, 1);
  const files = await readdir(join(home, "content-cache", "files"));
  state.token = "t2";
  await assert.rejects(revalidatedContent(api, "image.png", undefined, { expectedToken: "t1" }), { status: 409, code: "CONTENT_VERSION_CHANGED" });
  assert.equal(state.statuses.at(-1), 304);
  assert.deepEqual(await readdir(join(home, "content-cache", "files")), files);
  assert.equal(await withClientDatabase(home, (db) => db.prepare("SELECT count(*) AS n FROM content_cache").get().n), 1);
  const current = await revalidatedContent(api, "image.png", undefined, { expectedToken: "t2" });
  assert.equal(current.cacheHit, true); assert.equal(current.response.headers.get("X-Capsule-Token"), "t2");
  assert.deepEqual(Buffer.from(await current.response.arrayBuffer()), state.bytes);
  const compatible = await revalidatedContent(api, "image.png");
  assert.equal(compatible.cacheHit, true); await compatible.response.arrayBuffer();
  assert.equal(state.pulls, 1);
});
