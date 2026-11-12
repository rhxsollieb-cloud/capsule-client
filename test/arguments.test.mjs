import test from "node:test";
import assert from "node:assert/strict";
import { parseArguments } from "../src/commands/arguments.mjs";
import { configuration } from "../src/config.mjs";
import { entryPath, capsuleName } from "../src/system/paths.mjs";
import { main } from "../src/cli.mjs";

test("运行参数经过 -- 原样传递，写入需显式当前 token", () => {
  assert.deepEqual(
    parseArguments(["run", "工具", "--", "--file", "a b", "$(echo unsafe)"])
      .runtimeArgs,
    ["--file", "a b", "$(echo unsafe)"],
  );
  assert.throws(() => parseArguments(["put", "工具", "main.mjs", "/tmp/input"]), /token/u);
  assert.throws(() => parseArguments(["read", "工具", "--unknown", "1"]), /不支持/u);
  assert.throws(() => parseArguments(["list", "--limit", "-1"]), /整数/u);
  assert.throws(() => parseArguments(["read", "工具", "--from", "2", "--from", "3"]), /重复/u);
});

test("配置和内部路径拒绝歧义与越界", () => {
  assert.throws(() => configuration({ CAPSULE_SERVER_URL: "https://name:secret@example.com" }), /凭据/u);
  assert.throws(() => configuration({ CAPSULE_SERVER_URL: "https://example.com/api" }), /根地址/u);
  assert.equal(configuration({ CAPSULE_SERVER_URL: "https://example.com/" }).serverUrl, "https://example.com");
  for (const path of ["../a", "/tmp/a", "a/../b", "a\\b", "a//b", "."])
    assert.throws(() => entryPath(path));
  for (const name of ["..", "a/b", "NUL", " foo", "foo."])
    assert.throws(() => capsuleName(name));
});

test("帮助离线完成，参数失败返回非零", async () => {
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: {
      write(value) {
        stdout += value;
      },
    },
    stderr: {
      write(value) {
        stderr += value;
      },
    },
  };
  assert.equal(await main(["help", "put"], { CAPSULE_SERVER_URL: "invalid" }, io), 0);
  assert.match(stdout, /--token/u);
  assert.equal(await main(["put", "tool"], {}, io), 1);
  assert.match(stderr, /位置参数/u);
});
