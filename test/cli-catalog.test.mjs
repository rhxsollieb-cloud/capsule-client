import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commands, groups } from "../src/commands/catalog.mjs";
import { handlerNames } from "../src/commands/dispatch.mjs";
import { help } from "../src/commands/help.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { main } from "../src/cli.mjs";

function capture() {
  const output = { stdout: "", stderr: "" };
  return { output, io: { stdout: { write: (value) => { output.stdout += value; } }, stderr: { write: (value) => { output.stderr += value; } } } };
}

test("命令目录具备处理器，分层机器帮助离线且拒绝原型属性", async () => {
  const names = groups.flatMap((group) => group.commands.map((item) => item.name));
  assert.equal(new Set(names).size, names.length);
  for (const command of Object.values(commands)) {
    assert.ok(handlerNames.includes(command.handler), command.name);
    const schema = JSON.parse(help(command.name, { json: true }));
    assert.equal(schema.name, command.name);
    assert.match(schema.help, new RegExp("^" + command.name));
  }
  const { output, io } = capture();
  assert.equal(await main(["help", "mounts", "--json"], { CAPSULE_SERVER_URL: "invalid" }, io), 0);
  assert.ok(JSON.parse(output.stdout).commands.some((item) => item.name === "organize"));
  for (const name of ["toString", "constructor", "__proto__"]) {
    assert.throws(() => parseArguments([name]), /未知命令/);
    assert.throws(() => help(name), /未知命令/);
  }
});

test("公共输出参数不泄露到API参数，Skill分隔符后的宿主同名参数保持原样", () => {
  const args = parseArguments(["read", "正文.txt", "--fields", "body,lines", "--max-chars", "600", "--json-errors"]);
  assert.deepEqual(args.values, {});
  assert.deepEqual(args.output, { fields: ["body", "lines"], maxChars: 600, jsonErrors: true });
  assert.equal(parseArguments(["edit", "正文.txt", "--old-text", "旧", "--new-text=", "--all", "--token", "version"]).values.all, true);
  assert.deepEqual(parseArguments(["run", "工具", "--", "--json-errors", "--help"]).runtimeArgs, ["--json-errors", "--help"]);
  assert.throws(() => parseArguments(["list", "--raw"]), /不支持/);
  assert.throws(() => parseArguments(["read", "正文.txt", "--raw", "--fields", "body"]), /不能同时/);
  assert.throws(() => parseArguments(["organize", "--plan", "-", "--offset", "1"]), /不能通过offset/);
});

test("机器错误保留HTTP状态、事件和未知提交结果，凭据不输出", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: "version private-token", code: "VERSION_CONFLICT", eventId: "receipt" }, { status: 409 });
  });
  const first = capture();
  assert.equal(await main(["stat", "正文.txt", "--json-errors"], { CAPSULE_SERVER_URL: "http://backend.invalid", CAPSULE_TOKEN: "private-token" }, first.io), 1);
  assert.deepEqual(JSON.parse(first.output.stdout).error, { message: "version [凭据已隐藏]", code: "VERSION_CONFLICT", status: 409, command: "stat", eventId: "receipt" });
  assert.equal(calls, 1);
  assert.equal(first.output.stderr.includes("private-token"), false);
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("connection private-token"); });
  const second = capture();
  assert.equal(await main(["create", "正文.txt", "--json-errors"], { CAPSULE_SERVER_URL: "http://backend.invalid", CAPSULE_TOKEN: "private-token" }, second.io), 1);
  const error = JSON.parse(second.output.stdout).error;
  assert.equal(error.code, "RESULT_UNKNOWN");
  assert.equal(error.uncertain, true);
  assert.equal(error.unknownResult, true);
  assert.equal(calls, 2);
  assert.equal(second.output.stdout.includes("private-token"), false);
});

test("配置前参数错误也隐藏已知凭据，Skill参数不能开启宿主机器错误", async () => {
  for (const machine of [false, true]) {
    const { output, io } = capture();
    const args = ["unknown-private-token", ...(machine ? ["--json-errors"] : [])];
    assert.equal(await main(args, { CAPSULE_TOKEN: "private-token" }, io), 1);
    assert.equal(output.stdout.includes("private-token"), false);
    assert.equal(output.stderr.includes("private-token"), false);
    if (machine) assert.equal(JSON.parse(output.stdout).error.code, "CLI_ERROR");
  }
  const { output, io } = capture();
  assert.equal(await main(["run", "--", "--json-errors"], {}, io), 1);
  assert.equal(output.stdout, "");
  assert.match(output.stderr, /位置参数/);
});

test("paths不联网且不创建本机工作区", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-paths-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.method(globalThis, "fetch", () => { throw new Error("paths不应联网"); });
  const home = join(directory, "missing");
  const { output, io } = capture();
  assert.equal(await main(["paths"], { CAPSULE_CLIENT_HOME: home }, io), 0);
  assert.equal(JSON.parse(output.stdout).home, home);
  assert.equal(existsSync(home), false);
  assert.equal(output.stderr, "");
});
