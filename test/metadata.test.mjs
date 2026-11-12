import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cachedVersion } from "../src/cache/metadata.mjs";
import { synchronize } from "../src/cache/sync.mjs";
import { prepareRun } from "../src/runtime/snapshot.mjs";
import { execute, git } from "../src/system/process.mjs";
import { repositoryFixture } from "./fixture.mjs";

test("每提交元数据独立保留，运行使用选定提交的声明", async (t) => {
  const { api, record, repository, directory } = await repositoryFixture(t, "console.log('first');\n");
  const first = await synchronize(api, "工具");
  await writeFile(join(repository, "other.mjs"), "console.log('second');\n");
  await git(["add", "."], repository);
  await git(["commit", "-m", "new runtime"], repository);
  record.commit = await git(["rev-parse", "HEAD"], repository);
  record.runtime = { engine: "node", entry: "other.mjs" };
  await synchronize(api, "工具");
  assert.equal((await cachedVersion(api.config, "工具", first.commit)).runtime.entry, "main.mjs");
  assert.equal((await cachedVersion(api.config, "工具", record.commit)).runtime.entry, "other.mjs");
  assert.equal(existsSync(join(first.repository, "cap.json")), false);
  assert.equal(existsSync(join(first.repository, "..", "state.json")), false);
  const runDirectory = join(directory, "historical-run");
  await mkdir(runDirectory);
  const prepared = await prepareRun(api.config, first, runDirectory);
  const result = await execute(process.execPath, [prepared.entry], { cwd: prepared.work });
  assert.equal(result.stdout.trim(), "first");
  assert.equal(existsSync(join(prepared.work, ".git")), false);
});

test("同一提交的元数据变化被拒绝，不伪装同步成功", async (t) => {
  const { api, record } = await repositoryFixture(t, "console.log('unchanged');\n");
  await synchronize(api, "工具");
  record.runtime.entry = "different.mjs";
  await assert.rejects(synchronize(api, "工具"), /同一提交.*不同元数据/u);
  assert.equal((await cachedVersion(api.config, "工具", record.commit)).runtime.entry, "main.mjs");
});
