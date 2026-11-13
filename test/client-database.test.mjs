import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { databasePath, withClientDatabase } from "../src/storage/database.mjs";

test("多个CLI进程首次共用数据库，初始化与记录均完整保留", { timeout: 15000 }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), "capsule-database-init-"));
  const children = [];
  t.after(async () => {
    await Promise.all(children.filter((child) => child.exitCode === null && child.signalCode === null).map(async (child) => {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }));
    await rm(home, { recursive: true, force: true });
  });
  const script = `
    import { withClientDatabase } from ${JSON.stringify(new URL("../src/storage/database.mjs", import.meta.url).href)};
    process.on('message', async () => {
      try {
        await withClientDatabase(process.argv[1], db => db.prepare('INSERT INTO cache_heads VALUES (?,?,?)').run('http://same',process.argv[2],'commit'));
        process.exit(0);
      } catch(error) { console.error(error.message); process.exit(1); }
    });
    process.send('ready');
  `;
  children.push(...Array.from({ length: 8 }, (_, index) => spawn(process.execPath, ["--input-type=module", "-e", script, home, String(index)], { stdio: ["ignore", "ignore", "pipe", "ipc"] })));
  const diagnostics = children.map(() => "");
  children.forEach((child, index) => {
    child.stderr.on("data", (chunk) => { diagnostics[index] += chunk.toString(); });
  });
  await Promise.all(children.map((child) => once(child, "message")));
  const exits = children.map((child) => once(child, "exit"));
  children.forEach((child) => child.send("start"));
  (await Promise.all(exits)).forEach(([code], index) => assert.equal(code, 0, diagnostics[index]));
  const rows = await withClientDatabase(home, (database) => database.prepare("SELECT * FROM cache_heads").all());
  assert.equal(rows.length, children.length);
});

test("未知数据库格式不会被初始化覆盖", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "capsule-database-unknown-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const database = new DatabaseSync(databasePath(home));
  database.exec("CREATE TABLE user_notes(body TEXT); INSERT INTO user_notes VALUES ('keep');");
  database.close();
  await assert.rejects(withClientDatabase(home, () => {}), /格式不兼容/);
  const unchanged = new DatabaseSync(databasePath(home), { readOnly: true });
  try {
    assert.equal(unchanged.prepare("SELECT body FROM user_notes").get().body, "keep");
    assert.equal(unchanged.prepare("PRAGMA user_version").get().user_version, 0);
  } finally { unchanged.close(); }
});
