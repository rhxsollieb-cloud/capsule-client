import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiClient } from "../src/api/client.mjs";

test("二进制上传下载保持原字节，认证和写入基线分别发送", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-api-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from([0, 255, 23, 128, 10]);
  const input = join(directory, "input.bin");
  const output = join(directory, "output.bin");
  await writeFile(input, bytes);
  const api = new ApiClient({ serverUrl: "http://test", token: "private-token" }, async (url, init) => {
    assert.equal(init.headers.get("Authorization"), "Bearer private-token");
    assert.equal(new URL(url).searchParams.get("entry"), "原件.bin");
    if (init.method === "PUT") {
      assert.equal(init.headers.get("If-Match"), "baseline");
      const chunks = [];
      for await (const chunk of init.body) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), bytes);
      return Response.json({ commit: "updated" });
    }
    return new Response(bytes);
  });
  assert.equal((await api.upload("胶囊", "原件.bin", input, "baseline")).commit, "updated");
  await api.download(api.path("胶囊", "content", { entry: "原件.bin" }), output);
  assert.deepEqual(await readFile(output), bytes);
});

test("HTTP 冲突保留错误状态并隐藏凭据", async () => {
  const api = new ApiClient({ serverUrl: "http://test", token: "private-token" }, async () =>
    Response.json({ error: "冲突 private-token" }, { status: 409 }));
  await assert.rejects(api.json("/api/capsules"), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.message, "冲突 [凭据已隐藏]");
    return true;
  });
});

test("下载流中断后清理暂存，已有目标保持原字节", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-download-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = join(directory, "result.bin");
  const failing = new ApiClient({ serverUrl: "http://test", token: "" }, async () =>
    new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.error(new Error("模拟中途断开"));
      },
    })));
  await assert.rejects(failing.download("/content", destination), /中途断开/u);
  assert.deepEqual(await readdir(directory), []);
  await writeFile(destination, "original");
  const succeeding = new ApiClient({ serverUrl: "http://test", token: "" }, async () =>
    new Response("replacement"));
  await assert.rejects(succeeding.download("/content", destination), { code: "EEXIST" });
  assert.equal(await readFile(destination, "utf8"), "original");
  assert.deepEqual(await readdir(directory), ["result.bin"]);
});

test("下载目标目录无效时先拒绝，不打开远端媒体流", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-download-target-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let requested = false;
  const api = new ApiClient({ serverUrl: "http://test", token: "" }, async () => {
    requested = true;
    return new Response("media");
  });
  await assert.rejects(api.download("/content", join(directory, "missing", "media.bin")), {
    code: "ENOENT",
  });
  assert.equal(requested, false);
  assert.deepEqual(await readdir(directory), []);
});
