import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { revalidatedContent } from "../src/cache/content.mjs";
import { ContentCache } from "../src/cache/content-store.mjs";
import { withClientDatabase } from "../src/storage/database.mjs";
import { readOfficeSource } from "../src/office/source.mjs";
import { execute } from "../src/system/process.mjs";

const tag = (bytes, algorithm = "sha1") => '"' + createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex") + '"';
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "capsule-content-cache-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const state = { bytes: Buffer.from("first original"), commit: "commit-one", requests: 0, transfers: 0, transferredBytes: 0, allowed: true };
  const api = new ApiClient({ home, serverUrl: "http://content-cache.test", token: "employee-secret" }, async (url, init) => {
    assert.equal(init.headers.get("Authorization"), "Bearer employee-secret");
    if (!state.allowed) return Response.json({ error: "权限已撤销" }, { status: 403 });
    if (!new URL(url).pathname.endsWith("/content")) return Response.json({ name: "说明.docx", token: "token-" + state.commit, commit: state.commit });
    state.requests++;
    const headers = { ETag: tag(state.bytes), "X-Capsule-Commit": state.commit, "X-Capsule-Token": "token-" + state.commit };
    if (init.headers.get("If-None-Match") === headers.ETag) return new Response(null, { status: 304, headers });
    state.transfers++; state.transferredBytes += state.bytes.length;
    return new Response(state.bytes, { headers: { ...headers, "Content-Length": String(state.bytes.length) } });
  });
  return { home, api, state };
}
async function body(result) { return Buffer.from(await result.response.arrayBuffer()); }

test("重复读取和仅元数据变更以304复用原件，每次仍鉴权并返回本次提交", async (t) => {
  const { api, state, home } = await fixture(t);
  const first = await revalidatedContent(api, "说明.docx");
  assert.deepEqual(await body(first), state.bytes); assert.equal(first.cacheHit, false); assert.equal(first.cached, true);
  const second = await revalidatedContent(api, "说明.docx");
  assert.deepEqual(await body(second), state.bytes); assert.equal(second.cacheHit, true);
  state.commit = "metadata-only";
  const metadata = await revalidatedContent(api, "说明.docx");
  assert.equal(metadata.cacheHit, true); assert.equal(metadata.response.headers.get("X-Capsule-Commit"), state.commit);
  assert.equal(metadata.response.headers.get("Content-Length"), String(state.bytes.length));
  assert.equal(state.requests, 3); assert.equal(state.transfers, 1); assert.equal(state.transferredBytes, state.bytes.length);
  const files = await readdir(join(home, "content-cache", "files"));
  assert.equal(files.length, 1); assert.equal((await stat(join(home, "content-cache", "files", files[0]))).mode & 0o777, 0o600);
  const rows = await withClientDatabase(home, (db) => db.prepare("SELECT * FROM content_cache").all());
  assert.equal(JSON.stringify(rows).includes("employee-secret"), false);
  assert.equal(JSON.stringify(rows).includes("token-metadata-only"), false);
  state.bytes = Buffer.from("new original"); state.commit = "bytes-change";
  const changed = await revalidatedContent(api, "说明.docx");
  assert.deepEqual(await body(changed), state.bytes); assert.equal(changed.cacheHit, false); assert.equal(state.transfers, 2);
  state.allowed = false;
  await assert.rejects(revalidatedContent(api, "说明.docx"), { status: 403 });
  assert.equal(state.transfers, 2);
});

test("并发同原件合并一次body传输，已返回Buffer不受后续淘汰影响", async (t) => {
  const { api, state } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 4 }, () => revalidatedContent(api, "说明.docx")));
  assert.equal(state.transfers, 1); assert.equal(state.requests, 4);
  assert.equal(results.filter((item) => item.cacheHit).length, 3);
  for (const result of results) assert.deepEqual(await body(result), state.bytes);
});

test("独立CLI进程共享原件缓存，只传输一次body并分别重新鉴权", async (t) => {
  const { home } = await fixture(t);
  const bytes = Buffer.alloc(128 * 1024, 7), etag = tag(bytes);
  let requests = 0, transfers = 0, transferredBytes = 0;
  const server = createServer((request, response) => {
    requests++;
    assert.equal(request.headers.authorization, "Bearer isolated-employee");
    response.setHeader("ETag", etag);
    if (request.headers["if-none-match"] === etag) { response.writeHead(304); response.end(); return; }
    transfers++; transferredBytes += bytes.length;
    response.setHeader("Content-Length", String(bytes.length)); response.end(bytes);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const serverUrl = `http://127.0.0.1:${server.address().port}`;
  const script = join(home, "cache-child.mjs");
  await writeFile(script, `
import {ApiClient} from ${JSON.stringify(new URL("../src/api/client.mjs", import.meta.url).href)};
import {revalidatedContent} from ${JSON.stringify(new URL("../src/cache/content.mjs", import.meta.url).href)};
const [home,serverUrl]=process.argv.slice(2);
const result=await revalidatedContent(new ApiClient({home,serverUrl,token:'isolated-employee'}),'original.bin');
process.stdout.write(JSON.stringify({size:(await result.response.arrayBuffer()).byteLength,hit:result.cacheHit}));
`);
  const results = await Promise.all([0, 1].map(() => execute(process.execPath, [script, home, serverUrl])));
  assert.deepEqual(results.map((item) => JSON.parse(item.stdout).size), [bytes.length, bytes.length]);
  assert.equal(results.map((item) => JSON.parse(item.stdout)).filter((item) => item.hit).length, 1);
  assert.equal(requests, 2); assert.equal(transfers, 1); assert.equal(transferredBytes, bytes.length);
});

test("损坏原件缓存重新获取，链接和越界登记拒绝且外部资料不变", async (t) => {
  const { api, state, home } = await fixture(t);
  await body(await revalidatedContent(api, "说明.docx"));
  const row = await withClientDatabase(home, (db) => db.prepare("SELECT * FROM content_cache").get());
  const file = join(home, "content-cache", "files", row.file);
  await writeFile(file, "corruption");
  assert.deepEqual(await body(await revalidatedContent(api, "说明.docx")), state.bytes);
  assert.equal(state.transfers, 2);
  const external = join(home, "outside.txt"); await writeFile(external, "do not read or change");
  await unlink(file); await symlink(external, file);
  await assert.rejects(revalidatedContent(api, "说明.docx"), { code: "CONTENT_CACHE_INVALID" });
  assert.equal(await readFile(external, "utf8"), "do not read or change");
  await unlink(file);
  await withClientDatabase(home, (db) => db.prepare("UPDATE content_cache SET file='../outside.txt'").run());
  await assert.rejects(revalidatedContent(api, "说明.docx"), { code: "CONTENT_CACHE_INVALID" });
  assert.equal(state.transfers, 2);
});

test("原件LRU同时按字节和条数有界，不触碰Git缓存或运行状态", async (t) => {
  const { api, home } = await fixture(t);
  await writeFile(join(home, "protected-state"), "keep");
  const cache = new ContentCache(api.config, { fileBytes: 8, totalBytes: 12, entries: 2 });
  const a = cache.identity("a.txt"), b = cache.identity("b.txt"), c = cache.identity("c.txt");
  const bytes = Buffer.from("123456");
  await Promise.all([cache.publish(a, bytes, tag(bytes)), cache.publish(b, bytes, tag(bytes))]);
  await cache.read(a, 8);
  const held = await cache.read(a, 8);
  await cache.publish(c, bytes, tag(bytes));
  assert.equal(await cache.read(b, 8), undefined);
  assert.deepEqual((await cache.read(a, 8)).bytes, bytes);
  assert.deepEqual(held.bytes, bytes);
  assert.equal((await readdir(join(home, "content-cache", "files"))).length, 2);
  const total = await withClientDatabase(home, (db) => db.prepare("SELECT count(*) AS count,sum(size) AS bytes FROM content_cache").get());
  assert.equal(total.count, 2); assert.equal(total.bytes, 12);
  assert.equal(await readFile(join(home, "protected-state"), "utf8"), "keep");
});

test("ETag绑定实际Git blob，错误响应不入库，登记错配也不能产生304误命中", async (t) => {
  const { api, state, home } = await fixture(t);
  const cache = new ContentCache(api.config);
  const identity = cache.identity("说明.docx");
  await assert.rejects(cache.publish(identity, Buffer.from("different bytes"), tag(state.bytes)), { code: "CONTENT_INTEGRITY" });
  await cache.publish(identity, state.bytes, tag(state.bytes, "sha256"));
  assert.deepEqual((await cache.read(identity, 16 * 1024 * 1024)).bytes, state.bytes);
  await withClientDatabase(home, (db) => db.prepare("UPDATE content_cache SET etag=?").run(tag(Buffer.from("another original"))));
  assert.deepEqual(await body(await revalidatedContent(api, "说明.docx")), state.bytes);
  assert.equal(state.transfers, 1);
});

test("发布登记失败留下的派生文件在下一次index锁内回收，不突破磁盘配额", async (t) => {
  const { api, home } = await fixture(t);
  const cache = new ContentCache(api.config);
  await cache.index((db) => db.exec("CREATE TRIGGER reject_content_cache BEFORE INSERT ON content_cache BEGIN SELECT RAISE(ABORT,'publication failed'); END"));
  const identity = cache.identity("interrupted.txt"), bytes = Buffer.from("regenerable cache only");
  await assert.rejects(cache.publish(identity, bytes, tag(bytes)), /publication failed/);
  assert.deepEqual(await readdir(cache.files), [identity.file]);
  const pending = ".pending-" + randomUUID();
  await writeFile(join(cache.files, pending), "unfinished");
  await cache.index((db) => db.exec("DROP TRIGGER reject_content_cache"));
  assert.deepEqual(await readdir(cache.files), []);
  await writeFile(join(cache.files, "human-note.txt"), "preserve unknown file");
  await assert.rejects(cache.read(identity, 1024), { code: "CONTENT_CACHE_INVALID" });
  assert.equal(await readFile(join(cache.files, "human-note.txt"), "utf8"), "preserve unknown file");
  assert.equal((await readdir(join(home, "content-cache", "files"))).length, 1);
});

test("大文件和未知长度流不预读或缓存，Office有界读取仍取消超限传输", async (t) => {
  const { api, home } = await fixture(t);
  let reads = 0, cancelled = false;
  const makeStream = () => new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  api.fetcher = async () => new Response(makeStream(), { headers: { "Content-Length": String(32 * 1024 * 1024), ETag: '"' + "a".repeat(40) + '"' } });
  const large = await revalidatedContent(api, "large.bin", undefined, { allowStreaming: true });
  assert.equal(large.cached, false); assert.equal(reads, 0); await large.response.body.cancel();
  api.fetcher = async () => new Response(makeStream());
  const unknown = await revalidatedContent(api, "unknown.bin", undefined, { allowStreaming: true });
  assert.equal(reads, 0); await unknown.response.body.cancel();
  api.fetcher = async () => new Response(makeStream(), { headers: { "Content-Length": String(32 * 1024 * 1024) } });
  cancelled = false;
  await assert.rejects(revalidatedContent(api, "office.docx"), { status: 413 });
  assert.equal(cancelled, true); assert.equal(reads, 0);
  const rows = await withClientDatabase(home, (db) => db.prepare("SELECT count(*) AS total FROM content_cache").get().total);
  assert.equal(rows, 0);
});

test("Office重复读取复用缓存但仍核对前后版本，响应快照不能伪装成旧提交", async (t) => {
  const { api, state } = await fixture(t);
  assert.deepEqual((await readOfficeSource(api, "说明.docx")).buffer, state.bytes);
  state.commit = "metadata-change";
  assert.deepEqual((await readOfficeSource(api, "说明.docx")).buffer, state.bytes);
  assert.equal(state.transfers, 1);
  const original = api.fetcher;
  api.fetcher = async (url, init) => {
    const response = await original(url, init);
    if (new URL(url).pathname.endsWith("/content")) response.headers.set("X-Capsule-Commit", "different-snapshot");
    return response;
  };
  await assert.rejects(readOfficeSource(api, "说明.docx"), { status: 409 });
});
