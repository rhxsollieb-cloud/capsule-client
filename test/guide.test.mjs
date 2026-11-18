import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { main } from "../src/cli.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { help } from "../src/commands/help.mjs";
import { boundedResult } from "../src/commands/output.mjs";

const execute = promisify(execFile);
const sources = {
  data: new URL("../docs/data-format.md", import.meta.url),
  cli: new URL("../docs/cli-parity.md", import.meta.url),
  skills: new URL("../docs/skills.md", import.meta.url),
};
const textLines = (body) => body === "" ? [] : body.split(/\r\n|\n|\r/);

function capture() {
  const output = { stdout: "", stderr: "" };
  return { output, io: {
    stdout: { write: (value) => { output.stdout += value; } },
    stderr: { write: (value) => { output.stderr += value; } },
  } };
}

async function invoke(args, env = {}) {
  const { output, io } = capture();
  const code = await main(args, env, io);
  return { ...output, code };
}

test("guide随命令目录发现，索引与各主题原文在非法配置下仍离线且不创建工作区", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-guide-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; throw new Error("指南不得联网"); });
  const home = join(directory, "missing");
  const env = { CAPSULE_CLIENT_HOME: home, CAPSULE_SERVER_URL: "invalid", CAPSULE_CLIENT_URL: "invalid", CAPSULE_ONLYOFFICE_URL: "invalid" };
  const originals = await Promise.all(Object.values(sources).map((file) => readFile(file, "utf8")));
  const index = await invoke(["guide"], env);
  assert.equal(index.code, 0, index.stderr);
  const data = JSON.parse(index.stdout);
  assert.equal(data.guideVersion, 1);
  assert.equal(data.scope, "client-bundled");
  assert.deepEqual(data.topics.map(({ topic, source }) => ({ topic, source })), [
    { topic: "data", source: "docs/data-format.md" },
    { topic: "cli", source: "docs/cli-parity.md" },
    { topic: "skills", source: "docs/skills.md" },
  ]);
  assert.ok(data.topics.every((topic) => !Object.hasOwn(topic, "body")));
  for (const [topic, file] of Object.entries(sources)) {
    const result = await invoke(["guide", topic], env);
    assert.equal(result.code, 0, result.stderr);
    const page = JSON.parse(result.stdout);
    const lines = textLines(await readFile(file, "utf8"));
    assert.equal(page.topic, topic);
    assert.equal(page.source, "docs/" + basename(fileURLToPath(file)));
    assert.equal(page.body, lines.slice(0, 60).join("\n"));
    assert.equal(page.lines.to, Math.min(60, lines.length));
    assert.equal(Object.hasOwn(page, "token"), false);
    assert.equal(page.next?.from ?? null, page.lines.nextLine);
  }
  assert.equal(calls, 0);
  assert.equal(existsSync(home), false);
  assert.deepEqual(await readdir(directory), []);
  assert.deepEqual(await Promise.all(Object.values(sources).map((file) => readFile(file, "utf8"))), originals);
  const schema = JSON.parse(help("guide", { json: true }));
  assert.equal(schema.offline, true);
  assert.equal(schema.options.limit.maximum, 200);
  assert.equal(schema.options.raw.type, "boolean");
  assert.ok(JSON.parse(help("system", { json: true })).commands.some((item) => item.name === "guide"));
});

test("guide仅允许白名单主题，拒绝原型名称、任意路径与无效分页", async () => {
  for (const topic of ["toString", "constructor", "__proto__", "../docs/skills.md", "data/../skills", "/tmp/skills.md", "docs/skills.md"]) {
    const result = await invoke(["guide", topic, "--json-errors"], { CAPSULE_SERVER_URL: "invalid" });
    assert.equal(result.code, 1);
    assert.match(JSON.parse(result.stdout).error.message, /未知指南主题/);
  }
  for (const args of [["guide", "skills", "--from", "0"], ["guide", "skills", "--limit", "201"], ["guide", "skills", "--from", "1.5"], ["guide", "skills", "--token", "token"], ["guide", "skills", "extra"]])
    assert.throws(() => parseArguments(args));
  const indexRange = await invoke(["guide", "--limit", "10"]);
  assert.equal(indexRange.code, 1);
  assert.match(indexRange.stderr, /需要指定/);
});

test("guide从任意cwd读取随包原文，分页游标与raw正文相同", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-guide-cwd-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
  const { stdout, stderr } = await execute(process.execPath, [cli, "guide", "skills", "--from", "2", "--limit", "3"], {
    cwd: directory, env: { ...process.env, CAPSULE_SERVER_URL: "invalid", CAPSULE_CLIENT_URL: "invalid", CAPSULE_CLIENT_HOME: join(directory, "missing") },
  });
  const page = JSON.parse(stdout);
  const lines = textLines(await readFile(sources.skills, "utf8"));
  assert.equal(stderr, "");
  assert.equal(page.body, lines.slice(1, 4).join("\n"));
  assert.deepEqual(page.next, { topic: "skills", from: 5, limit: 3 });
  assert.deepEqual(page.lines, { from: 2, to: 4, total: lines.length, nextLine: 5, truncated: true });
  const raw = await invoke(["guide", "skills", "--from", "2", "--limit", "3", "--raw"]);
  assert.equal(raw.code, 0, raw.stderr);
  assert.equal(raw.stdout, page.body);
  const eof = JSON.parse((await invoke(["guide", "skills", "--from", String(lines.length + 5)])).stdout);
  assert.equal(eof.body, "");
  assert.equal(eof.next, null);
  assert.equal(eof.lines.nextLine, null);
  assert.deepEqual(await readdir(directory), []);
});

test("guide输出预算缩行时同步next，fields保留身份与续读，超长单行不跳读", async () => {
  const result = await invoke(["guide", "skills", "--limit", "200", "--max-chars", "512"]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.trimEnd().length <= 512);
  const page = JSON.parse(result.stdout);
  assert.equal(page.budgetLimited, true);
  assert.equal(page.next.topic, "skills");
  assert.equal(page.next.from, page.lines.nextLine);
  assert.equal(page.next.from, page.lines.to + 1);
  const follow = JSON.parse((await invoke(["guide", page.next.topic, "--from", String(page.next.from), "--limit", "1"])).stdout);
  const lines = textLines(await readFile(sources.skills, "utf8"));
  assert.equal(follow.body, lines[page.next.from - 1]);
  const selected = JSON.parse((await invoke(["guide", "skills", "--limit", "1", "--fields", "body"])).stdout);
  assert.equal(selected.guideVersion, 1);
  assert.equal(selected.source, "docs/skills.md");
  assert.equal(selected.topic, "skills");
  assert.equal(selected.next.from, 2);
  assert.equal(selected.lines.nextLine, 2);
  const single = boundedResult({ ...selected, body: "x".repeat(5000) }, 512);
  assert.equal(single.dataOmitted, true);
  assert.equal(single.body, undefined);
  assert.equal(single.lines.to, 0);
  assert.equal(single.lines.nextLine, 1);
  assert.equal(single.next.from, 1);
  assert.ok(JSON.stringify(single, null, 2).length <= 512);
  const raw = await invoke(["guide", "skills", "--limit", "200", "--raw", "--max-chars", "512"]);
  assert.equal(raw.code, 1);
  assert.equal(raw.stdout, "");
  assert.match(raw.stderr, /输出预算/);
});

test("guide的out保留完整选定页且拒绝覆盖，除显式输出文件外没有副作用", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-guide-out-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "guide.json");
  const home = join(directory, "missing");
  const env = { CAPSULE_CLIENT_HOME: home, CAPSULE_SERVER_URL: "invalid" };
  const result = await invoke(["guide", "data", "--limit", "200", "--max-chars", "512", "--out", file], env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).output, file);
  const content = await readFile(file, "utf8");
  const page = JSON.parse(content);
  const lines = textLines(await readFile(sources.data, "utf8"));
  assert.equal(page.body, lines.slice(0, 200).join("\n"));
  assert.equal(page.budgetLimited, undefined);
  const refused = await invoke(["guide", "data", "--out", file], env);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /已存在/);
  assert.equal(await readFile(file, "utf8"), content);
  assert.equal(existsSync(home), false);
  assert.deepEqual(await readdir(directory), ["guide.json"]);
});
