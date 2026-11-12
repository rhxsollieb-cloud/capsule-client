import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { missingServer, serverFixture } from "./serverFixture.mjs";

test("真实服务端与CLI完成写入、挂载、版本同步和本地执行", {
  skip: missingServer,
  timeout: 60000,
}, async (t) => {
  const { directory, application, cli } = await serverFixture(t);

  assert.equal((await fetch(`${application.url}/api/health`)).status, 401);
  assert.equal((await cli("health")).apiVersion, 3);
  const parent = await cli("create", "工具", "--description", "工具入口");
  assert.equal(parent.name, "工具");
  await cli("mount", "工具", "/工具");

  const original = await cli("create", "报价工具", "--kind", "code", "--engine", "node", "--entry", "main.mjs");
  assert.equal(original.kind, "code");
  const source = join(directory, "main.mjs");
  await writeFile(source, "console.log(process.argv.slice(2).map(Number).reduce((a, b) => a + b, 0));\n");
  const written = await cli("put", "报价工具", "main.mjs", source, "--token", original.token);
  assert.notEqual(written.commit, original.commit);
  assert.equal(written.name, original.name);
  const codeRoot = join(directory, "server", "capsules", original.name);
  assert.equal((await stat(join(codeRoot, "main.mjs"))).isFile(), true);
  assert.equal(existsSync(join(codeRoot, "cap.json")), false);
  assert.equal(existsSync(join(codeRoot, "files")), false);
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
  const alternateSource = join(directory, "alternate.mjs");
  await writeFile(alternateSource, "console.log('alternate runtime');\n");
  const alternate = await cli("put", "报价工具", "alternate.mjs", alternateSource, "--token", upgraded.token);
  const metadata = await cli("update", "报价工具", "--engine", "node", "--entry", "alternate.mjs", "--token", alternate.token);
  assert.equal((await cli("run", "报价工具")).stdout.trim(), "alternate runtime");
  const reverted = await cli("revert", "报价工具", upgraded.commit, "--token", metadata.token);
  assert.equal(reverted.status, "succeeded");
  const restored = await cli("run", "报价工具");
  assert.equal(restored.stdout.trim(), "upgraded");
  assert.equal(restored.commit, reverted.result.commit);
  assert.notEqual(restored.commit, upgraded.commit);
  const historical = await cli("stat", "报价工具", "--commit", metadata.commit);
  assert.equal(historical.runtime.entry, "alternate.mjs");
  assert.equal(historical.token, undefined);
  const history = await cli("history", "报价工具");
  assert.ok(history.items.some((item) => item.commit === written.commit));

  const position = await cli("position", "/工具/报价工具");
  await cli("unmount", "/工具/报价工具", "--token", position.token);
  assert.equal((await cli("ls", "/工具")).items.length, 0);
  assert.equal((await cli("stat", "报价工具")).commit, restored.commit);
});

test("统一接口管理SQLite日志、超过64MiB的媒体和代码运行记录", {
  skip: missingServer,
  timeout: 120000,
}, async (t) => {
  const { directory, clientHome, cli } = await serverFixture(t);

  const database = await cli("create", "运行资料", "--kind", "database");
  assert.equal(database.kind, "database");
  const root = join(directory, "server", "capsules", database.name);
  assert.equal(existsSync(join(root, "capsule.sqlite")), false);
  assert.equal(existsSync(join(root, "cap.json")), false);
  assert.equal(existsSync(join(root, "data.sqlite")), true);
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
  assert.equal(existsSync(join(clientHome, "client.sqlite")), true);
  assert.equal(existsSync(join(result.directory, "result.json")), false);
  const databases = await cli("list", "--kind", "database");
  assert.equal(databases.items.length, 1);
});

test("平铺单文件使用顶层元数据及系统Git，排队回撤恢复内容与说明", {
  skip: missingServer,
  timeout: 60000,
}, async (t) => {
  const { directory, application, clientHome, cli } = await serverFixture(t);
  const source = join(directory, "source.txt");
  await writeFile(source, "原始内容\n");
  const created = await cli("create", "产品说明.txt", "--kind", "text",
    "--description", "原始说明", "--body", source);
  const contentRoot = join(directory, "server", "capsules");
  const file = join(contentRoot, created.name);
  assert.equal((await stat(file)).isFile(), true);
  assert.equal(await readFile(file, "utf8"), "原始内容\n");
  assert.equal((await cli("read", created.name)).body, "原始内容\n");

  const metadata = await cli("update", created.name, "--description", "新的说明", "--token", created.token);
  await writeFile(source, "修订内容\n");
  const written = await cli("put", created.name, source, "--token", metadata.token);
  const versions = await readdir(join(directory, "server", "versions"));
  assert.ok(versions.length > 0);
  const database = new DatabaseSync(join(directory, "server", "catalog.sqlite"), { readOnly: true });
  try {
    const row = database.prepare("SELECT description,kind FROM capsules WHERE name=?").get(created.name);
    assert.equal(row.description, "新的说明");
    assert.equal(row.kind, "text");
  } finally {
    database.close();
  }

  const picture = await cli("create", "现场.jpg", "--kind", "image");
  const image = join(directory, "source.jpg");
  const bytes = Buffer.from([255, 216, 0, 255, 217]);
  await writeFile(image, bytes);
  await cli("put", picture.name, image, "--token", picture.token);
  const download = join(directory, "copy.jpg");
  await cli("get", picture.name, download);
  assert.deepEqual(await readFile(download), bytes);
  assert.equal((await stat(join(contentRoot, picture.name))).isFile(), true);

  const undone = await cli("revert", created.name, created.commit, "--token", written.token);
  assert.equal(undone.status, "succeeded");
  assert.notEqual(undone.result.commit, created.commit);
  assert.equal(undone.result.description, "原始说明");
  assert.equal(await readFile(file, "utf8"), "原始内容\n");
  assert.deepEqual(await readFile(join(contentRoot, picture.name)), bytes);
  assert.equal((await cli("event", undone.id)).status, "succeeded");
  assert.ok((await cli("events")).items.some((event) => event.id === undone.id));
  const synchronized = await cli("sync", created.name);
  assert.equal(synchronized.commit, undone.result.commit);
  assert.deepEqual((await readdir(synchronized.repository)).filter((name) => name !== ".git"), [created.name]);
  assert.equal(await readFile(join(synchronized.repository, created.name), "utf8"), "原始内容\n");
  assert.equal(existsSync(join(clientHome, "client.sqlite")), true);
  const historical = await cli("stat", created.name, "--commit", written.commit);
  assert.equal(historical.description, "新的说明");
  assert.equal(historical.token, undefined);
  const denied = await fetch(`${application.url}/api/capsules/${encodeURIComponent(created.name)}/content?entry=${encodeURIComponent(picture.name)}`, {
    headers: { Authorization: "Bearer integration-only-token" },
  });
  assert.equal(denied.status, 400);
});
