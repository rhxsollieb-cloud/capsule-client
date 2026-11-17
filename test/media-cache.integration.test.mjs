import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { createUiApplication } from "../src/ui/application.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

test("工作台原件复用本机缓存、条件重验且不绕过撤权，Range只传所需字节", {
  skip: missingServer, timeout: 60000,
}, async (t) => {
  const { application, clientHome, directory } = await serverFixture(t);
  const config = { home: clientHome, serverUrl: application.url, token: "integration-only-token" };
  let transferred = 0;
  const reads = [];
  const api = new ApiClient(config, async (url, init) => {
    const response = await fetch(url, init);
    if (!new URL(url).pathname.endsWith("/content")) return response;
    reads.push({ method: init.method || "GET", status: response.status, range: init.headers.get("Range") });
    if (!response.body) return response;
    return new Response(response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
      transferred += chunk.byteLength; controller.enqueue(chunk);
    } })), { status: response.status, headers: response.headers });
  });
  const ui = createUiApplication({ config, api, port: 0 });
  await ui.start(); t.after(() => ui.close());
  let cap = await application.capsules.create({ name: "重复读取.png", kind: "image" });
  const bytes = Buffer.alloc(1024 * 1024, 0x78), file = join(directory, "media-original.bin");
  await writeFile(file, bytes);
  cap = await application.capsules.putFile(cap.name, undefined, file, cap.token);
  const url = ui.url + "/ui/content?" + new URLSearchParams({ name: cap.name });
  const first = await fetch(url);
  const etag = first.headers.get("ETag");
  assert.ok(etag);
  assert.equal(first.headers.get("Cache-Control"), "private, no-cache");
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), bytes);
  assert.equal(transferred, bytes.length);
  const second = await fetch(url);
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), bytes);
  assert.equal(transferred, bytes.length, "重复打开不能再次传原件");
  assert.equal(reads.at(-1).status, 304);

  cap = await application.capsules.update(cap.name, { description: "只改说明", token: cap.token });
  const described = await fetch(url);
  assert.equal(described.headers.get("ETag"), etag);
  assert.equal(described.headers.get("X-Capsule-Commit"), cap.commit);
  await described.arrayBuffer();
  assert.equal(transferred, bytes.length, "只改元数据不能重传相同媒体");
  const conditional = await fetch(url, { headers: { "If-None-Match": etag } });
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Length"), String(bytes.length));
  assert.equal(await head.text(), "");
  assert.equal(transferred, bytes.length);
  const partial = await fetch(url, { headers: { Range: "bytes=1-3", "If-Range": etag } });
  assert.equal(partial.status, 206);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(1, 4));
  assert.equal(transferred, bytes.length + 3, "小范围请求不能预取整个原件");
  assert.equal(reads.at(-1).range, "bytes=1-3");

  await writeFile(file, "changed bytes");
  await application.capsules.putFile(cap.name, undefined, file, cap.token);
  const changed = await fetch(url);
  assert.notEqual(changed.headers.get("ETag"), etag);
  assert.equal(await changed.text(), "changed bytes");
  assert.equal(transferred, bytes.length + 3 + Buffer.byteLength("changed bytes"));
  config.token = "revoked-invalid-credential";
  const denied = await fetch(url);
  assert.equal(denied.status, 401);
  assert.equal((await denied.text()).includes("changed bytes"), false);
});
