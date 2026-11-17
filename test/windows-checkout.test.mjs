import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, execute } from "../src/system/process.mjs";
import { assertWorkingTree, validateCheckoutTree } from "../src/system/gitWorkingCopy.mjs";
import { repositoryFixture } from "./fixture.mjs";
import { synchronize } from "../src/cache/sync.mjs";

async function rawTree(t, paths, mode = "100644") {
  const directory = await mkdtemp(join(tmpdir(), "capsule Windows 名称 "));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  await git(["init", "-b", "main"], directory);
  await git(["config", "core.ignoreCase", "false"], directory);
  const blob = await git(["hash-object", "-w", "--stdin"], directory);
  for (const path of paths) await git(["update-index", "--add", "--cacheinfo", mode, blob, path], directory);
  return { directory, tree: await git(["write-tree"], directory) };
}

test("Git 工作树校验支持中文、空格和原生路径，仍拒绝另一目录", async (t) => {
  const { directory, tree } = await rawTree(t, ["SKILL.md", "scripts/cli.mjs"]);
  await assertWorkingTree(directory, "wrong root");
  await validateCheckoutTree(directory, tree, { platform: "win32" });
  const nested = join(directory, "nested");
  await mkdir(nested);
  await assert.rejects(assertWorkingTree(nested, "wrong root"), /wrong root/);
});

test("Windows 文件冲突由 Git 对象树检测，无需先写出相互覆盖的文件", async (t) => {
  const { directory, tree } = await rawTree(t, ["README.md", "readme.md"]);
  await assert.rejects(validateCheckoutTree(directory, tree, { platform: "win32" }), { code: "WINDOWS_PATH_UNSUPPORTED" });
  await validateCheckoutTree(directory, tree, { platform: "linux" });
});

test("符号链接从 Git mode 识别，不能在 Windows 降级为普通文件绕过校验", async (t) => {
  const { directory, tree } = await rawTree(t, ["linked"], "120000");
  for (const platform of ["win32", "linux"])
    await assert.rejects(validateCheckoutTree(directory, tree, { platform }), { code: "CHECKOUT_ENTRY_UNSUPPORTED" });
});

test("Windows 原生缓存同步拒绝大小写冲突版本并保留旧提交和字节", { skip: process.platform !== "win32" ? "需要 Windows 原生文件系统" : false }, async (t) => {
  for (const aliases of [["README.txt", "readme.txt"], ["σ.txt", "ς.txt"]]) {
    const { api, repository, record } = await repositoryFixture(t, "old version\n");
    const old = await synchronize(api, "工具");
    await git(["config", "core.ignoreCase", "false"], repository);
    const blob = await git(["rev-parse", "HEAD:main.mjs"], repository);
    // Construct the conflicting tree without creating Windows-colliding files.
    for (const path of aliases) await git(["update-index", "--add", "--cacheinfo", "100644", blob, path], repository);
    const tree = await git(["write-tree"], repository);
    record.commit = await git(["commit-tree", tree, "-p", record.commit, "-m", "conflicting remote tree"], repository);
    await git(["update-ref", "refs/heads/main", record.commit], repository);
    await assert.rejects(synchronize(api, "工具"), { code: "WINDOWS_PATH_UNSUPPORTED" });
    assert.equal(await git(["rev-parse", "HEAD"], old.repository), old.commit);
    assert.equal(await readFile(join(old.repository, "main.mjs"), "utf8"), "old version\n");
  }
});

test("Windows 长路径可以同步到精确提交且不改变受管字节", { skip: process.platform !== "win32" ? "需要 Git for Windows 与 NTFS" : false }, async (t) => {
  const { api, repository, record } = await repositoryFixture(t, "old\n");
  const entry = ["测试目录".repeat(10), "带 空格目录".repeat(10), "继续深入目录".repeat(10), "保持原字节.txt"].join("/");
  const source = join(repository, "bytes.tmp");
  await writeFile(source, "一行\r\n二行\n");
  const blob = await git(["hash-object", "-w", "--no-filters", "--", source], repository);
  await rm(source);
  await git(["update-index", "--add", "--cacheinfo", "100644", blob, entry], repository);
  record.commit = await git(["commit-tree", await git(["write-tree"], repository), "-p", record.commit, "-m", "deep tree"], repository);
  await git(["update-ref", "refs/heads/main", record.commit], repository);
  const synced = await synchronize(api, "工具");
  assert.ok(join(synced.repository, entry).length > 260);
  assert.equal(await readFile(join(synced.repository, entry), "utf8"), "一行\r\n二行\n");
  const actual = await execute("git", ["rev-parse", "--show-toplevel"], { cwd: synced.repository });
  assert.ok(actual.stdout.includes("/"));
});
