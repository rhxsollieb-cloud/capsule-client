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

test("每提交元数据独立保留，skill运行使用选定提交的固定入口内容", async (t) => {
  const { api, record, repository, directory } = await repositoryFixture(t, "console.log('first');\n");
  const first = await synchronize(api, "工具");
  await writeFile(join(repository, "other.mjs"), "console.log('second');\n");
  await writeFile(join(repository, "scripts", "cli.mjs"), 'import "../other.mjs";\n');
  await git(["add", "."], repository);
  await git(["commit", "-m", "new runtime"], repository);
  record.commit = await git(["rev-parse", "HEAD"], repository);
  record.description = "second version";
  await synchronize(api, "工具");
  assert.equal((await cachedVersion(api.config, "工具", first.commit)).description, "");
  assert.equal((await cachedVersion(api.config, "工具", record.commit)).description, "second version");
  assert.equal((await cachedVersion(api.config, "工具", record.commit)).runtime.entry, "scripts/cli.mjs");
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
  assert.equal((await cachedVersion(api.config, "工具", record.commit)).runtime.entry, "scripts/cli.mjs");
});

test("同一提交的runtime字段键顺序不构成元数据变化", async (t) => {
  const { api, record } = await repositoryFixture(t, "same\n");
  let downloads = 0;
  const download = api.download;
  api.download = async (...args) => { downloads++; return download(...args); };
  await synchronize(api, "工具");
  record.runtime = { entry: "scripts/cli.mjs", engine: "node" };
  assert.equal((await synchronize(api, "工具")).changed, false);
  assert.equal(downloads, 1);
  assert.deepEqual((await cachedVersion(api.config, "工具", record.commit)).runtime, { engine: "node", entry: "scripts/cli.mjs" });
});
