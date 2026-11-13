import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { withCacheLock } from "../src/cache/lock.mjs";
import { cacheDirectory, synchronize } from "../src/cache/sync.mjs";
import { prepareRun } from "../src/runtime/snapshot.mjs";
import { prepareSkillWorkspace } from "../src/skills/workspace.mjs";
import { repositoryFixture } from "./fixture.mjs";

test("运行快照与同步持同一缓存锁，等待后仍固定所选提交", async (t) => {
  const { api, directory, update } = await repositoryFixture(t, "console.log('selected');\n");
  const first = await synchronize(api, "工具");
  let release, entered;
  const acquired = new Promise((resolve) => { entered = resolve; });
  const holding = withCacheLock(cacheDirectory(api.config, first.name) + ".lock", async () => {
    entered();
    await new Promise((resolve) => { release = resolve; });
  });
  await acquired;
  const destination = join(directory, "selected-run");
  await mkdir(destination);
  let complete = false;
  const preparing = prepareRun(api.config, first, destination).then((result) => { complete = true; return result; });
  // Attach immediately so a regression to a fail-fast lock is reported rather than unhandled.
  preparing.catch(() => {});
  try {
    await setTimeout(50);
    assert.equal(complete, false);
  } finally { release(); await holding; }
  const latest = await update("console.log('latest');\n");
  const [prepared, synced] = await Promise.all([preparing, synchronize(api, first.name)]);
  assert.equal(synced.commit, latest);
  assert.equal(await readFile(join(prepared.work, "main.mjs"), "utf8"), "console.log('selected');\n");
  assert.equal(await readFile(join(synced.repository, "main.mjs"), "utf8"), "console.log('latest');\n");
});

test("同步后缓存被手工改动，消费者拒绝忽略或覆盖该改动", async (t) => {
  const { api, directory } = await repositoryFixture(t, "console.log('saved');\n");
  const synced = await synchronize(api, "工具");
  const file = join(synced.repository, "main.mjs");
  await writeFile(file, "local draft");
  const destination = join(directory, "dirty-run");
  await mkdir(destination);
  await assert.rejects(prepareRun(api.config, synced, destination), /未提交改动/);
  assert.equal(await readFile(file, "utf8"), "local draft");
  assert.deepEqual(await readdir(destination), []);
});

test("同提交并发准备Skill工作区复用一次发布，持久状态保留", async (t) => {
  const { api } = await repositoryFixture(t, "console.log('skill');\n");
  const synced = await synchronize(api, "工具");
  const records = await Promise.all(Array.from({ length: 4 }, () => prepareSkillWorkspace(api.config, synced)));
  assert.equal(new Set(records.map((record) => record.work)).size, 1);
  const record = records[0];
  await writeFile(join(record.state, "state.txt"), "keep runtime state");
  const again = await prepareSkillWorkspace(api.config, synced);
  assert.equal(await readFile(join(again.state, "state.txt"), "utf8"), "keep runtime state");
  assert.equal(await readFile(join(again.work, "main.mjs"), "utf8"), "console.log('skill');\n");
  const root = join(record.work, "..", "..", "..");
  assert.equal((await readdir(root)).some((name) => name.startsWith(".register-")), false);
});
