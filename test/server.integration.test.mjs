import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  assert.equal((await cli("health")).apiVersion, 2);
  const parent = await cli("create", "工具", "--description", "工具入口");
  assert.equal(parent.name, "工具");
  await cli("mount", "工具", "/工具");

  const original = await cli("create", "报价工具", "--engine", "node", "--entry", "main.mjs");
  assert.equal(original.kind, "code");
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

test("统一接口管理SQLite日志、超过64MiB的媒体和代码运行记录", {
  skip: existsSync(applicationPath) ? false : "缺少服务端源码，请设置 CAPSULE_SERVER_ROOT 执行跨项目集成检查",
  timeout: 120000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-database-contract-"));
  const { createApplication } = await import(pathToFileURL(applicationPath).href);
  const application = createApplication({ home: join(directory, "server"), port: 0 });
  t.after(async () => {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  });
  await application.start();
  const clientHome = join(directory, "client");
  const environment = {
    ...process.env,
    CAPSULE_SERVER_URL: application.url,
    CAPSULE_TOKEN: "",
    CAPSULE_CLIENT_HOME: clientHome,
  };
  const cli = async (...args) => {
    const result = await execute(process.execPath, [join(clientRoot, "src/cli.mjs"), ...args], {
      env: environment,
      timeout: 90000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(result.stdout);
  };

  const database = await cli("create", "运行资料", "--kind", "database");
  assert.equal(database.kind, "database");
  const root = join(directory, "server", "capsules", database.name);
  assert.equal(existsSync(join(root, "capsule.sqlite")), false);
  assert.equal(JSON.parse(await readFile(join(root, "cap.json"), "utf8")).kind, "database");
  const schema = await cli("write", database.name, "--sql",
    "CREATE TABLE events (id INTEGER PRIMARY KEY, message TEXT NOT NULL, media_path TEXT REFERENCES _cap_files(path))",
    "--token", database.token);

  const original = join(directory, "录像.bin");
  const mediaBytes = 65 * 1024 * 1024 + 17;
  const handle = await open(original, "wx");
  await handle.truncate(mediaBytes);
  await handle.close();
  const attached = await cli("put", database.name, "media/录像.bin", original, "--token", schema.token);
  const files = await cli("query", database.name, "--sql", "SELECT path,size FROM _cap_files");
  assert.deepEqual(files.items, [{ path: "media/录像.bin", size: mediaBytes }]);

  const inserted = await cli("write", database.name, "--sql",
    "INSERT INTO events(message,media_path) VALUES (?,?)", "--params",
    JSON.stringify(["媒体日志", "media/录像.bin"]), "--token", attached.token);
  const queried = await cli("query", database.name, "--sql", "SELECT message FROM events WHERE media_path=?",
    "--params", JSON.stringify(["media/录像.bin"]), "--limit", "1");
  assert.deepEqual(queried.items, [{ message: "媒体日志" }]);
  const target = join(directory, "download.bin");
  await cli("get", database.name, "media/录像.bin", target);
  assert.equal((await stat(target)).size, mediaBytes);
  const downloaded = await open(target, "r");
  const last = Buffer.alloc(1);
  await downloaded.read(last, 0, 1, mediaBytes - 1);
  await downloaded.close();
  assert.equal(last[0], 0);
  await assert.rejects(
    cli("remove-entry", database.name, "media/录像.bin", "--token", inserted.token),
  );
  assert.equal((await cli("stat", database.name)).commit, inserted.commit);

  const code = await cli("create", "记录工具", "--kind", "code", "--engine", "node", "--entry", "main.mjs");
  const script = join(directory, "main.mjs");
  await writeFile(script, "console.log('database log');\n");
  const written = await cli("put", code.name, "main.mjs", script, "--token", code.token);
  const result = await cli("run", code.name, "--log-cap", database.name);
  assert.equal(result.commit, written.commit);
  assert.equal(result.exitCode, 0);
  const logs = await cli("query", database.name, "--sql", "SELECT name,commit_id,stdout,exit_code FROM cap_run_logs");
  assert.equal(logs.items.length, 1);
  assert.equal(logs.items[0].name, code.name);
  assert.equal(logs.items[0].commit_id, written.commit);
  assert.equal(logs.items[0].stdout.trim(), "database log");
  assert.equal(logs.items[0].exit_code, 0);
  assert.equal(existsSync(join(clientHome, "runs.sqlite")), true);
  assert.equal(existsSync(join(result.directory, "result.json")), false);
  const databases = await cli("list", "--kind", "database");
  assert.equal(databases.items.length, 1);
});
