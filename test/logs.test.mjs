import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { saveRun } from "../src/runtime/logs.mjs";
import { runCapsule } from "../src/runtime/run.mjs";
import { git } from "../src/system/process.mjs";
import { repositoryFixture } from "./fixture.mjs";

function query(home, sql) {
  const database = new DatabaseSync(join(home, "runs.sqlite"), { readOnly: true });
  try {
    return database.prepare(sql).all();
  } finally {
    database.close();
  }
}

test("旧JSON运行记录入库后移除，损坏记录保留并报告", async (t) => {
  const { api } = await repositoryFixture(t, "console.log('ok');\n");
  const oldDirectory = join(api.config.home, "runs", "legacy");
  const damagedDirectory = join(api.config.home, "runs", "damaged");
  await mkdir(oldDirectory, { recursive: true });
  await mkdir(damagedDirectory);
  await writeFile(join(oldDirectory, "result.json"), JSON.stringify({
    id: "legacy", name: "旧工具", commit: "old-commit", exitCode: 5, stdout: "old output",
  }));
  const damaged = join(damagedDirectory, "result.json");
  await writeFile(damaged, "{invalid json");
  const result = await runCapsule(api, "工具");
  assert.equal(result.exitCode, 0);
  assert.equal(result.logWarnings.length, 1);
  assert.equal(existsSync(join(oldDirectory, "result.json")), false);
  assert.equal(await readFile(damaged, "utf8"), "{invalid json");
  assert.equal(existsSync(join(result.directory, "result.json")), false);
  const records = query(api.config.home, "SELECT id,exit_code FROM runs ORDER BY id");
  assert.equal(records.find((record) => record.id === "legacy").exit_code, 5);
  assert.equal(records.find((record) => record.id === result.id).exit_code, 0);
  await saveRun(api.config.home, { ...result });
  assert.equal(query(api.config.home, "SELECT id FROM runs").length, 2);
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

test("运行声明与提交内容不一致时拒绝执行并记录失败", async (t) => {
  const { api, repository, record } = await repositoryFixture(t, "console.log('must not execute');\n");
  const manifest = JSON.parse(await readFile(join(repository, "cap.json"), "utf8"));
  manifest.runtime.entry = "other.mjs";
  await writeFile(join(repository, "cap.json"), JSON.stringify(manifest));
  await git(["add", "cap.json"], repository);
  await git(["commit", "-m", "mismatched runtime"], repository);
  record.commit = await git(["rev-parse", "HEAD"], repository);
  await assert.rejects(runCapsule(api, "工具"), /cap.json.*不一致/u);
  const stored = query(api.config.home, "SELECT record_json FROM runs");
  assert.match(JSON.parse(stored[0].record_json).error, /不一致/u);
});
