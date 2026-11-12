import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { saveRun } from "../src/runtime/logs.mjs";
import { runCapsule } from "../src/runtime/run.mjs";
import { repositoryFixture } from "./fixture.mjs";

function query(home, sql) {
  const database = new DatabaseSync(join(home, "client.sqlite"), { readOnly: true });
  try {
    return database.prepare(sql).all();
  } finally {
    database.close();
  }
}

test("运行记录和缓存元数据保存在同一顶层SQLite", async (t) => {
  const { api } = await repositoryFixture(t, "console.log('ok');\n");
  const result = await runCapsule(api, "工具");
  assert.equal(result.exitCode, 0);
  assert.equal(existsSync(join(result.directory, "result.json")), false);
  assert.equal(existsSync(join(api.config.home, "runs.sqlite")), false);
  assert.equal(query(api.config.home, "SELECT id FROM runs").length, 1);
  assert.equal(query(api.config.home, "SELECT name FROM cache_versions").length, 1);
  const tables = query(api.config.home, "SELECT name FROM sqlite_schema WHERE type='table'");
  assert.equal(tables.some((row) => row.name.startsWith("migration")), false);
  await saveRun(api.config.home, { ...result });
  assert.equal(query(api.config.home, "SELECT id FROM runs").length, 1);
});

test("远端日志事务失败保留本地实际结果且不重新执行", async (t) => {
  const { api, record } = await repositoryFixture(t, "console.log('executed once');\n");
  const original = api.json;
  let writes = 0;
  api.json = async (path, method, body) => {
    if (path.name !== "业务日志") return original(path, method, body);
    if (path.operation === "write") {
      writes++;
      assert.equal(body.token, "db-token");
      assert.equal(body.statements.length, 2);
      assert.equal(body.statements[1].parameters[2], record.commit);
      throw new Error("日志版本发生冲突");
    }
    return { name: "业务日志", kind: "database", token: "db-token" };
  };
  const result = await runCapsule(api, "工具", [], { logCap: "业务日志" });
  assert.equal(result.stdout.trim(), "executed once");
  assert.equal(result.exitCode, 0);
  assert.equal(result.logError.remote, "日志版本发生冲突");
  assert.equal(writes, 1);
  const stored = query(api.config.home, "SELECT record_json FROM runs");
  assert.equal(JSON.parse(stored[0].record_json).stdout.trim(), "executed once");
});

test("日志提交待恢复时将事件ID随实际运行结果保存", async (t) => {
  const { api } = await repositoryFixture(t, "console.log('completed');\n");
  const original = api.json;
  let writes = 0;
  api.json = async (path, method, body) => {
    if (path.name !== "业务日志") return original(path, method, body);
    if (path.operation !== "write")
      return { name: "业务日志", kind: "database", token: "db-token" };
    writes++;
    throw Object.assign(new Error("日志提交已保存，发布待恢复"), {
      code: "PUBLISH_PENDING",
      eventId: "log-receipt",
    });
  };
  const result = await runCapsule(api, "工具", [], { logCap: "业务日志" });
  assert.equal(result.stdout.trim(), "completed");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.logCap, { name: "业务日志", eventId: "log-receipt" });
  assert.equal(writes, 1);
  const stored = query(api.config.home, "SELECT record_json FROM runs");
  assert.equal(JSON.parse(stored[0].record_json).logCap.eventId, "log-receipt");
});
