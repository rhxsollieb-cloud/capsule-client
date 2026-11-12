import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { synchronize } from "../src/cache/sync.mjs";
import { runCapsule } from "../src/runtime/run.mjs";
import { git } from "../src/system/process.mjs";
import { repositoryFixture } from "./fixture.mjs";

test("同步 bundle 并切换精确提交，已有修改保持原样", async (t) => {
  const { api, record, update } = await repositoryFixture(t, "console.log('first');\n");
  const first = await synchronize(api, "工具");
  assert.equal(await git(["rev-parse", "HEAD"], first.repository), record.commit);
  assert.equal((await synchronize(api, "工具")).changed, false);
  const secondCommit = await update("console.log('second');\n");
  const second = await synchronize(api, "工具");
  assert.equal(second.commit, secondCommit);
  assert.equal(
    await readFile(join(second.repository, "files", "main.mjs"), "utf8"),
    "console.log('second');\n",
  );
  await writeFile(join(second.repository, "files", "main.mjs"), "my draft");
  await assert.rejects(synchronize(api, "工具"), /未提交改动/u);
  assert.equal(await readFile(join(second.repository, "files", "main.mjs"), "utf8"), "my draft");
});

test("运行使用独立目录，记录提交号、参数和非零退出码", async (t) => {
  const { api, record } = await repositoryFixture(t, `
import { writeFileSync } from "node:fs";

writeFileSync("output.txt", process.argv[2]);
console.log(process.cwd());
process.exitCode = 7;
`);
  const result = await runCapsule(api, "工具", ["a b $(unsafe)"]);
  assert.equal(result.commit, record.commit);
  assert.equal(result.exitCode, 7);
  assert.equal(await readFile(join(result.directory, "work", "output.txt"), "utf8"), "a b $(unsafe)");
  assert.equal(JSON.parse(await readFile(join(result.directory, "result.json"), "utf8")).exitCode, 7);
  const cached = await synchronize(api, "工具");
  assert.equal(await git(["status", "--porcelain"], cached.repository), "");
});

test("运行器明确报告尚未提供的第三方依赖环境", async (t) => {
  const { api, repository, record } = await repositoryFixture(t, "console.log('unused');\n");
  await writeFile(join(repository, "files", "package.json"), JSON.stringify({ dependencies: { example: "1.0.0" } }));
  await git(["add", "."], repository);
  await git(["commit", "-m", "dependency"], repository);
  record.commit = await git(["rev-parse", "HEAD"], repository);
  await assert.rejects(runCapsule(api, "工具"), /第三方依赖/u);
});

test("Git 忽略的本地文件同样阻止缓存覆盖", async (t) => {
  const { api, repository, record } = await repositoryFixture(t, "console.log('unused');\n");
  await writeFile(join(repository, ".gitignore"), "files/scratch/\n");
  await git(["add", ".gitignore"], repository);
  await git(["commit", "-m", "ignore scratch"], repository);
  record.commit = await git(["rev-parse", "HEAD"], repository);
  const cached = await synchronize(api, "工具");
  const scratch = join(cached.repository, "files", "scratch");
  await mkdir(scratch);
  await writeFile(join(scratch, "draft.txt"), "keep this draft");
  await assert.rejects(synchronize(api, "工具"), /未提交改动/u);
  assert.equal(await readFile(join(scratch, "draft.txt"), "utf8"), "keep this draft");
});
