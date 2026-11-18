import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseArguments } from "../src/commands/arguments.mjs";

const run = promisify(execFile);
const entry = new URL("../src/cli.mjs", import.meta.url);

test("npm 的 POSIX 命令链接启动同一 CLI 并输出机器帮助", {
  skip: process.platform === "win32" && "Windows npm 使用命令包装器",
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-cli-link-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const link = join(directory, "capsule");
  await symlink(fileURLToPath(entry), link, "file");
  const { stdout } = await run(process.execPath, [link, "help", "stat", "--json"]);
  assert.equal(JSON.parse(stdout).name, "stat");
});

test("按入口路径启动 CLI 与作为模块导入的行为独立", async () => {
  const direct = await run(process.execPath, [fileURLToPath(entry), "help", "stat", "--json"]);
  assert.equal(JSON.parse(direct.stdout).name, "stat");
  const imported = await run(process.execPath, ["--input-type=module", "--eval",
    `const command = await import(${JSON.stringify(entry.href)}); console.log(typeof command.main);`,
    "--", "help", "stat", "--json"]);
  assert.equal(imported.stdout.trim(), "function");
});

test("普通命令的分隔符保护以选项前缀开始的名称，run 保留独立的 Skill 参数", () => {
  assert.deepEqual(parseArguments(["stat", "--", "--2026书目.md"]).positional, ["--2026书目.md"]);
  assert.deepEqual(parseArguments(["mount", "--", "--help", "/主题/--help"]).positional, ["--help", "/主题/--help"]);
  const skill = parseArguments(["run", "工具", "--", "--help", "-h", "--json"]);
  assert.deepEqual(skill.positional, ["工具"]);
  assert.deepEqual(skill.runtimeArgs, ["--help", "-h", "--json"]);
});

test("短帮助选项作为文本值时保持原意，命令级机器帮助仍可用", () => {
  const create = parseArguments(["create", "书目.md", "--description", "-h"]);
  assert.equal(create.command, "create");
  assert.equal(create.values.description, "-h");
  assert.deepEqual(parseArguments(["read", "--json", "-h"]), { command: "help", topic: "read", helpJson: true });
});

test("整数选项只接受范围内的十进制值，避免空白和其他数制被隐式转换", () => {
  assert.equal(parseArguments(["list", "--offset=0", "--limit", "05"]).values.limit, 5);
  for (const option of ["--offset=", "--offset= ", "--offset=0x10", "--offset=1e2", "--offset=1.0"])
    assert.throws(() => parseArguments(["list", option]), /有效整数/);
});
