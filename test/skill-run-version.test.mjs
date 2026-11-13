import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { skillPaths } from "../src/storage/paths.mjs";
import { readRegistration, saveRegistration } from "../src/skills/registry.mjs";
import { runCapsule } from "../src/runtime/run.mjs";
import { repositoryFixture } from "./fixture.mjs";

test("旧协作UI活跃或状态未知时拒绝新版CLI，脚本及共享状态均不执行", async (t) => {
  const { api, record, update } = await repositoryFixture(t, "console.log('old CLI');\n");
  const oldCommit = record.commit;
  const paths = skillPaths(api.config, record.name);
  await mkdir(paths.state, { recursive: true });
  const marker = join(paths.state, "execution.txt");
  await writeFile(marker, "untouched");
  const nextCommit = await update(`
import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.env.CAPSULE_SKILL_STATE, "execution.txt"), "new CLI executed");
console.log("new CLI");
`);
  for (const state of ["running", "starting", "stopping", "unknown"]) {
    await saveRegistration(api.config, { name: record.name, commit: oldCommit, lastSession: { state } });
    await assert.rejects(runCapsule(api, record.name), (error) => error.status === 409 && error.code === "SKILL_UPDATE_PENDING" && /skill-stop.*skill-register/u.test(error.message));
    assert.equal(await readFile(marker, "utf8"), "untouched");
    assert.equal(existsSync(join(api.config.home, "runs")), false);
    assert.equal((await readRegistration(api.config, record.name)).commit, oldCommit);
  }
  await saveRegistration(api.config, { name: record.name, commit: oldCommit, lastSession: { state: "stopped" } });
  const result = await runCapsule(api, record.name);
  assert.equal(result.commit, nextCommit);
  assert.equal(result.stdout.trim(), "new CLI");
  assert.equal(await readFile(marker, "utf8"), "new CLI executed");
});

test("协作UI与最新提交相同仍执行精确CLI快照并复用共享状态", async (t) => {
  const { api, record } = await repositoryFixture(t, `
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const file = join(process.env.CAPSULE_SKILL_STATE, "counter.txt");
writeFileSync(file, String(Number(readFileSync(file, "utf8")) + 1));
console.log(process.env.CAPSULE_SKILL_STATE);
`);
  const paths = skillPaths(api.config, record.name);
  await mkdir(paths.state, { recursive: true });
  await writeFile(join(paths.state, "counter.txt"), "10");
  await saveRegistration(api.config, { name: record.name, commit: record.commit, lastSession: { state: "running" } });
  const result = await runCapsule(api, record.name);
  assert.equal(result.commit, record.commit);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), paths.state);
  assert.equal(await readFile(join(paths.state, "counter.txt"), "utf8"), "11");
  assert.equal((await readRegistration(api.config, record.name)).lastSession.state, "running");
});
