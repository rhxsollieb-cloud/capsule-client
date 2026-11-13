import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { readJsonInput, readTextInput } from "../src/commands/input.mjs";
import { boundedResult, machineError, prepareOutput, printResult } from "../src/commands/output.mjs";
import { dispatch } from "../src/cli.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";

test("机器错误按事件终态判断未知结果，不从确定失败的说明误推", () => {
  for (const status of ["failed", "conflict"]) {
    const error = Object.assign(new Error("此操作不能自动重放，旧结果未知"), { eventId: "event-1", code: "EVENT_FAILED", result: { id: "event-1", status } });
    assert.equal(machineError(error).error.unknownResult, undefined);
    error.uncertain = true;
    assert.equal(machineError(error).error.unknownResult, true);
  }
  const pending = Object.assign(new Error("等待超时，不能自动重放"), { result: { status: "pending" } });
  assert.equal(machineError(pending).error.unknownResult, true);
});

test("正文与JSON共享有界UTF-8输入，标准输入不当成文件名", async () => {
  assert.equal(await readTextInput("-", { stdin: Readable.from([Buffer.from("\ufeff正文\r\n")]) }), "\ufeff正文\r\n");
  assert.deepEqual(await readJsonInput("-", { stdin: Readable.from([Buffer.from('\ufeff[{"x":1}]')]) }), [{ x: 1 }]);
  await assert.rejects(readTextInput("-", { stdin: Readable.from([Buffer.from([255])]) }), /UTF-8/);
  await assert.rejects(readTextInput("-", { stdin: Readable.from(["a\0b"]) }), /NUL/);
  await assert.rejects(readTextInput("-", { stdin: Readable.from(["ab", "cd"]), maxBytes: 3 }), /上限/);
  const calls = [];
  const api = { json: async (_path, _method, body) => { calls.push(body); return body; } };
  await dispatch(parseArguments(["create", "正文.txt", "--body", "-"]), api, { stdin: Readable.from(["标准输入正文"]) });
  assert.equal(calls[0].body, "标准输入正文");
});

test("输出预算保留有效记录页与行游标，不伪造完整正文", () => {
  const page = { items: [0, 1, 2, 3].map((id) => ({ name: String(id), text: "x".repeat(160) })), total: 20, nextOffset: 14 };
  const result = boundedResult(page, 512, { offset: 10 });
  assert.ok(JSON.stringify(result, null, 2).length <= 512);
  assert.ok(result.items.length > 0 && result.items.length < 4);
  assert.equal(result.nextOffset, 10 + result.items.length);
  const body = { token: "version", body: Array.from({ length: 80 }, (_, i) => `${i} ${"x".repeat(20)}`).join("\n"), lines: { from: 100, to: 179, total: 200, nextLine: 180, truncated: true } };
  const limited = boundedResult(body, 512);
  assert.ok(JSON.stringify(limited, null, 2).length <= 512);
  assert.equal(limited.lines.nextLine, 100 + limited.body.split("\n").length);
  assert.equal(limited.token, "version");
  const single = boundedResult({ body: "x".repeat(5000), lines: { from: 1, to: 1, total: 1, nextLine: null } }, 512);
  assert.equal(single.dataOmitted, true);
  assert.equal(single.lines.nextLine, 1);
  assert.equal(single.body, undefined);
  const error = boundedResult({ error: { message: "x".repeat(5000), status: 409, code: "CONFLICT", eventId: "id" } }, 512);
  assert.equal(error.error.status, 409);
  assert.ok(JSON.stringify(error, null, 2).length <= 512);
  const giant = boundedResult({ token: "t".repeat(10000), eventId: "e".repeat(10000), error: { status: 409, code: "CONFLICT", message: "\0".repeat(10000) } }, 512);
  assert.ok(JSON.stringify(giant, null, 2).length <= 512);
  assert.equal(giant.error.status, 409);
  assert.equal(giant.error.code, "CONFLICT");
  assert.ok(giant.omittedFields.includes("token"));
  assert.equal(giant.token, undefined);
});

test("搜索候选游标不按输出命中数推进，fields与raw输出明确", async () => {
  const search = { items: [{ name: "A", matches: [{ text: "x".repeat(300) }] }, { name: "B", matches: [{ text: "y".repeat(300) }] }], total: 100, nextOffset: 40, scanned: { from: 20, to: 40, total: 100 } };
  const limited = boundedResult(search, 512);
  assert.equal(limited.dataOmitted, true);
  assert.equal(limited.nextOffset, 20);
  let stdout = "";
  const io = { stdout: { write: (value) => { stdout += value; } } };
  await printResult({ name: "A", token: "token", body: "body", secret: "omit", lines: { nextLine: null } }, { output: { fields: ["body"] } }, io);
  assert.deepEqual(JSON.parse(stdout), { name: "A", token: "token", body: "body", lines: { nextLine: null } });
  stdout = "";
  await printResult({ body: "exact\n", lines: {} }, { output: { raw: true } }, io);
  assert.equal(stdout, "exact\n");
  await assert.rejects(printResult({ body: "x".repeat(2000) }, { output: { raw: true, maxChars: 512 } }, io), /不完整正文/);
});

test("完整输出安全发布，不覆盖既有文件，发布竞态不留半文件", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-output-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "result.json");
  const output = { outFile: file };
  await prepareOutput(output);
  const data = { items: [{ body: "x".repeat(20000) }] };
  let receipt;
  await printResult(data, { output }, { stdout: { write: (value) => { receipt = JSON.parse(value); } } });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), data);
  assert.equal(receipt.output, file);
  await assert.rejects(prepareOutput(output), /已存在/);
  const raced = join(directory, "race.json");
  await prepareOutput({ outFile: raced });
  await writeFile(raced, "keep");
  await assert.rejects(printResult({ commit: "saved" }, { output: { outFile: raced } }), (error) => error.code === "OUTPUT_WRITE_FAILED" && error.result.commit === "saved");
  assert.equal(await readFile(raced, "utf8"), "keep");
  assert.equal((await readdir(directory)).some((name) => name.startsWith(".capsule-output-")), false);
});
