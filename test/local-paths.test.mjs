import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { configuration, localClientOrigin } from "../src/config.mjs";
import { clientPaths } from "../src/storage/paths.mjs";

test("本机地址与UI端口一致，paths只读且不暴露凭据", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "capsule-paths-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, "uninitialized");
  const config = configuration({ CAPSULE_CLIENT_HOME: home, CAPSULE_UI_PORT: "5999", CAPSULE_TOKEN: "private-token" });
  const paths = clientPaths(config);
  assert.equal(paths.clientUrl, "http://127.0.0.1:5999");
  assert.equal(paths.database, join(home, "client.sqlite"));
  assert.equal(existsSync(home), false);
  assert.equal(JSON.stringify(paths).includes("private-token"), false);
});

test("本机通道拒绝远端、凭据和额外路径，保留独立Office来源配置", () => {
  for (const url of ["https://localhost:5183", "http://example.com:5183", "http://user:password@localhost:5183", "http://localhost:5183/path", "http://localhost:5183/?token=x"]) assert.throws(() => localClientOrigin(url));
  assert.equal(localClientOrigin("http://[::1]:5183/"), "http://[::1]:5183");
  const config = configuration({ CAPSULE_CLIENT_URL: "http://localhost:5444", CAPSULE_ONLYOFFICE_URL: "https://docs.example" });
  assert.equal(config.clientUrl, "http://localhost:5444");
  assert.equal(config.officeEditorUrl, "https://docs.example");
});
