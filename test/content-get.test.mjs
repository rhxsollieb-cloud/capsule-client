import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { execute } from "../src/system/process.mjs";

test("两个实际CLI get共用一次原件传输，已有目标零请求且撤权不返回缓存", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "capsule-cached-get-"));
  const bytes = Buffer.alloc(128 * 1024, 0x78);
  const etag = '"' + createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") + '"';
  let requests = 0, transfers = 0, transferredBytes = 0, allowed = true;
  const server = createServer((request, response) => {
    requests++;
    assert.equal(request.headers.authorization, "Bearer isolated-get-employee");
    assert.equal(request.headers["x-capsule-lease"], undefined);
    if (!allowed) { response.writeHead(403, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: "权限已撤销", code: "FORBIDDEN" })); return; }
    response.setHeader("ETag", etag);
    if (request.headers["if-none-match"] === etag) { response.writeHead(304); response.end(); return; }
    transfers++; transferredBytes += bytes.length;
    response.setHeader("Content-Length", String(bytes.length)); response.end(bytes);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(home, { recursive: true, force: true }); });
  const env = { ...process.env, CAPSULE_SERVER_URL: `http://127.0.0.1:${server.address().port}`,
    CAPSULE_CLIENT_HOME: join(home, "client"), CAPSULE_TOKEN: "isolated-get-employee" };
  const cli = (target) => execute(process.execPath, [fileURLToPath(new URL("../src/cli.mjs", import.meta.url)), "get", "original.bin", target], { env, check: false });
  const targets = [join(home, "first.bin"), join(home, "second.bin")];
  const results = await Promise.all(targets.map(cli));
  assert.deepEqual(results.map((result) => result.exitCode), [0, 0]);
  for (const target of targets) assert.deepEqual(await readFile(target), bytes);
  assert.equal(requests, 2); assert.equal(transfers, 1); assert.equal(transferredBytes, bytes.length);
  const existing = await cli(targets[0]);
  assert.equal(existing.exitCode, 1); assert.match(existing.stderr, /目标已存在/);
  assert.equal(requests, 2, "目标预检必须早于缓存重验请求");
  allowed = false;
  const deniedPath = join(home, "must-not-exist.bin"), denied = await cli(deniedPath);
  assert.equal(denied.exitCode, 1); assert.match(denied.stderr, /权限已撤销/);
  assert.equal(requests, 3); assert.equal(transfers, 1);
  await assert.rejects(stat(deniedPath), { code: "ENOENT" });
});
