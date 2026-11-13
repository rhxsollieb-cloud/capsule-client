import { skillPaths } from "../src/storage/paths.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSkill, parseSkill } from "../src/skills/format.mjs";
import { runCapsule } from "../src/runtime/run.mjs";
import { git } from "../src/system/process.mjs";
import { repositoryFixture } from "./fixture.mjs";

test("skill用成熟YAML读取必需字段，拒绝歧义、占位与别名", () => {
  assert.deepEqual(parseSkill("---\r\nname: test-tool\r\ndescription: >-\r\n  Read files and\r\n  report their sizes.\r\nmetadata:\r\n  version: 1\r\n---\r\n# Instructions"),
    { name: "test-tool", description: "Read files and report their sizes." });
  for (const text of [
    "# Missing frontmatter",
    "---\nname: valid\nname: duplicate\ndescription: test\n---\n",
    "---\nname: Bad_Name\ndescription: test\n---\n",
    "---\nname: valid\ndescription: '[TODO: write this]'\n---\n",
    "---\nname: valid\ndescription: '<script>'\n---\n",
    "---\n- name: valid\n- description: test\n---\n",
    "---\nname: &skill valid\ndescription: *skill\n---\n",
  ]) assert.throws(() => parseSkill(text));
  assert.throws(() => parseSkill("\0"), /UTF-8/u);
});

test("skill固定CLI入口及可选UI必须是普通文件", async (t) => {
  const { repository } = await repositoryFixture(t, "console.log('helper');\n");
  let skill = await loadSkill(repository);
  assert.equal(skill.entry, await realpath(join(repository, "scripts", "cli.mjs")));
  assert.equal(skill.uiEntry, undefined);
  await writeFile(join(repository, "scripts", "ui.mjs"), "console.log('optional UI');\n");
  skill = await loadSkill(repository);
  assert.equal(skill.uiEntry, await realpath(join(repository, "scripts", "ui.mjs")));
  // Entrypoints must never follow links outside the managed tree.
  const linked = join(repository, "linked-skill");
  await mkdir(join(linked, "scripts"), { recursive: true });
  await writeFile(join(linked, "SKILL.md"), "---\nname: linked\ndescription: Check linked entry.\n---\n");
  await symlink(join(repository, "scripts", "cli.mjs"), join(linked, "scripts", "cli.mjs"));
  await assert.rejects(loadSkill(linked), /符号链接/u);
});

test("CLI运行共享按服务端和cap隔离的持久状态且不继承凭据", async (t) => {
  const { api, record } = await repositoryFixture(t, `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const state = process.env.CAPSULE_SKILL_STATE;
const file = join(state, "count.txt");
const count = existsSync(file) ? Number(readFileSync(file, "utf8")) + 1 : 1;
writeFileSync(file, String(count));
console.log(JSON.stringify({ state, count, hasToken: Object.hasOwn(process.env, "CAPSULE_TOKEN"), arg: process.argv[2] }));
`);
  const previous = { CAPSULE_TOKEN: process.env.CAPSULE_TOKEN, CAPSULE_SKILL_STATE: process.env.CAPSULE_SKILL_STATE };
  process.env.CAPSULE_TOKEN = "must-not-reach-skill";
  process.env.CAPSULE_SKILL_STATE = "/wrong-state";
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const first = await runCapsule(api, record.name, ["literal $(unsafe)"]);
  const second = await runCapsule(api, record.name);
  const paths = skillPaths(api.config, record.name);
  assert.deepEqual(JSON.parse(first.stdout), { state: paths.state, count: 1, hasToken: false, arg: "literal $(unsafe)" });
  assert.equal(JSON.parse(second.stdout).count, 2);
  assert.equal(await readFile(join(paths.state, "count.txt"), "utf8"), "2");
  assert.notEqual(paths.state, skillPaths({ ...api.config, serverUrl: "http://other-server" }, record.name).state);
  assert.notEqual(paths.state, skillPaths(api.config, "另一个工具").state);
  assert.equal(existsSync(join(first.directory, "snapshot")), false);
});

test("只有合法skill可运行，固定入口不回退到旧runtime", async (t) => {
  const { api, record, repository } = await repositoryFixture(t, "console.log('must not run');\n");
  record.runtime.entry = "main.mjs";
  await assert.rejects(runCapsule(api, record.name), /固定入口/u);
  record.runtime.entry = "scripts/cli.mjs";
  await writeFile(join(repository, "SKILL.md"), "# Old code without skill metadata\n");
  await git(["add", "."], repository);
  await git(["commit", "-m", "invalid skill"], repository);
  record.commit = await git(["rev-parse", "HEAD"], repository);
  await assert.rejects(runCapsule(api, record.name), /frontmatter/u);
});
