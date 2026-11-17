import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { passwordInput } from "../src/commands/password-input.mjs";

function terminal() {
  const stdin = Object.assign(new EventEmitter(), { isTTY: true, isRaw: false,
    setRawMode(value) { this.isRaw = value; }, resume() {}, pause() {} });
  let output = "";
  return { stdin, stderr: { write: (value) => { output += value; } }, output: () => output };
}

test("不支持的终端控制序列明确失败并恢复终端", async () => {
  const io = terminal();
  const result = passwordInput(undefined, io);
  io.stdin.emit("data", Buffer.from("secret\u001bx"));
  await assert.rejects(result, /控制序列/);
  assert.equal(io.output().includes("secret"), false);
  assert.equal(io.stdin.isRaw, false);
});

test("完整 Unicode 密码与拆块方向键正确输入且不回显", async () => {
  const io = terminal();
  const expected = "密钥α_AbC123456";
  const bytes = Buffer.from(expected);
  const result = passwordInput(undefined, io);
  io.stdin.emit("data", bytes.subarray(0, 1));
  io.stdin.emit("data", bytes.subarray(1, 5));
  io.stdin.emit("data", bytes.subarray(5));
  io.stdin.emit("data", Buffer.from("\u001b"));
  io.stdin.emit("data", Buffer.from("["));
  io.stdin.emit("data", Buffer.from("A\r"));
  assert.equal(await result, expected);
  assert.equal(io.output().includes(expected), false);
  assert.equal(io.stdin.isRaw, false);
  assert.equal(io.stdin.listenerCount("data"), 0);
});
