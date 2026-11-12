import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = process.env.CAPSULE_SERVER_ROOT
  ? resolve(process.env.CAPSULE_SERVER_ROOT)
  : resolve(clientRoot, "../capsule-server");
const applicationPath = join(serverRoot, "src/application.mjs");

test("真实服务端与CLI完成写入、挂载、版本同步和本地执行", {
  skip: existsSync(applicationPath) ? false : "缺少服务端源码，请设置 CAPSULE_SERVER_ROOT 执行跨项目集成检查",
  timeout: 60000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-contract-"));
  const { createApplication } = await import(pathToFileURL(applicationPath).href);
  const application = createApplication({
    home: join(directory, "server"),
    host: "127.0.0.1",
    port: 0,
    token: "integration-only-token",
  });
  t.after(async () => {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  });
  await application.start();
  const environment = {
    ...process.env,
    CAPSULE_SERVER_URL: application.url,
    CAPSULE_TOKEN: "integration-only-token",
    CAPSULE_CLIENT_HOME: join(directory, "client"),
  };
  const cli = async (...args) => {
    const result = await execute(process.execPath, [join(clientRoot, "src/cli.mjs"), ...args], {
      env: environment,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(result.stdout);
  };

  assert.equal((await fetch(`${application.url}/api/health`)).status, 401);
  assert.equal((await cli("health")).apiVersion, 1);
  const parent = await cli("create", "工具", "--description", "工具入口");
  assert.equal(parent.name, "工具");
  await cli("mount", "工具", "/工具");

  const original = await cli("create", "报价工具", "--engine", "node", "--entry", "main.mjs");
  const source = join(directory, "main.mjs");
  await writeFile(source, "console.log(process.argv.slice(2).map(Number).reduce((a, b) => a + b, 0));\n");
  const written = await cli("put", "报价工具", "main.mjs", source, "--token", original.token);
  assert.notEqual(written.commit, original.commit);
  assert.equal(written.name, original.name);
  const entries = await cli("entries", "报价工具");
  assert.ok(entries.items.some((entry) => entry.path === "main.mjs"));

  await cli("mount", "报价工具", "/工具/报价工具");
  const tree = await cli("ls", "/工具");
  assert.equal(tree.items.length, 1);
  assert.equal(tree.items[0].name, "报价工具");

  const body = await cli("read", "报价工具", "main.mjs", "--from", "1", "--limit", "1");
  assert.match(body.body, /console\.log/);
  assert.equal(body.lines.from, 1);
  await assert.rejects(
    cli("put", "报价工具", "main.mjs", source, "--token", original.token),
    (error) => error.code !== 0 && /409|版本|变化|冲突|基线/.test(error.stderr),
  );

  const synchronized = await cli("sync", "报价工具");
  assert.equal(synchronized.commit, written.commit);
  const executed = await cli("run", "报价工具", "--", "2", "3");
  assert.equal(executed.commit, written.commit);
  assert.equal(executed.exitCode, 0);
  assert.equal(executed.stdout.trim(), "5");

  await writeFile(source, "console.log('upgraded');\n");
  const upgraded = await cli("put", "报价工具", "main.mjs", source, "--token", written.token);
  const nextRun = await cli("run", "报价工具");
  assert.equal(nextRun.commit, upgraded.commit);
  assert.notEqual(nextRun.commit, executed.commit);
  assert.equal(nextRun.stdout.trim(), "upgraded");
  const history = await cli("history", "报价工具");
  assert.ok(history.items.some((item) => item.commit === written.commit));

  const position = await cli("position", "/工具/报价工具");
  await cli("unmount", "/工具/报价工具", "--token", position.token);
  assert.equal((await cli("ls", "/工具")).items.length, 0);
  assert.equal((await cli("stat", "报价工具")).commit, upgraded.commit);
});
