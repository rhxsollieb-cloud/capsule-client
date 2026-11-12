import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { synchronize } from "../src/cache/sync.mjs";
import { runCapsule } from "../src/runtime/run.mjs";
import { prepareWorkingCopy } from "../src/system/gitWorkingCopy.mjs";
import { git } from "../src/system/process.mjs";
import { repositoryFixture } from "./fixture.mjs";

test("缓存和运行快照在全局转换及胶囊属性下保持原件字节", async (t) => {
  const source = `
import { readFileSync } from "node:fs";

console.log(readFileSync("original.txt").toString("hex"));
`;
  const fixture = await repositoryFixture(t, source);
  const { api, repository, record, directory } = fixture;
  const bytes = Buffer.from("first\r\nsecond\n$Id$\r\n", "utf8");
  await prepareWorkingCopy(repository);
  await writeFile(join(repository, "original.txt"), bytes);
  await writeFile(
    join(repository, ".gitattributes"),
    "* text eol=crlf ident filter=fail\n*.txt working-tree-encoding=UTF-16\n",
  );
  await git(["add", "."], repository);
  await git(["commit", "-m", "original bytes and embedded attributes"], repository);
  record.commit = await git(["rev-parse", "HEAD"], repository);

  const globalConfig = join(directory, "global.gitconfig");
  await git(["config", "--file", globalConfig, "core.autocrlf", "true"], repository);
  await git(["config", "--file", globalConfig, "filter.fail.required", "true"], repository);
  const previousConfig = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  t.after(() => {
    if (previousConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousConfig;
  });

  const cached = await synchronize(api, "工具");
  assert.deepEqual(
    await readFile(join(cached.repository, "original.txt")),
    bytes,
  );
  assert.equal((await synchronize(api, "工具")).changed, false);
  const run = await runCapsule(api, "工具");
  assert.equal(run.exitCode, 0);
  assert.equal(run.stdout.trim(), bytes.toString("hex"));
  assert.deepEqual(
    await readFile(join(run.directory, "work", "original.txt")),
    bytes,
  );

  const updatedBytes = Buffer.from("updated\r\n$Id$\n", "utf8");
  await writeFile(join(repository, "original.txt"), updatedBytes);
  await git(["add", "."], repository);
  await git(["commit", "-m", "update original bytes"], repository);
  record.commit = await git(["rev-parse", "HEAD"], repository);
  const updated = await synchronize(api, "工具");
  assert.deepEqual(
    await readFile(join(updated.repository, "original.txt")),
    updatedBytes,
  );
});
