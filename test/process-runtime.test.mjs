import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execute } from "../src/system/process.mjs";
import { skillEnvironment } from "../src/skills/environment.mjs";
import { spawnInterface, stopProcess } from "../src/skills/process.mjs";

test("Node 直接启动保留空格、中文、反斜杠和 shell 字符参数", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule 进程-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const args = ["含 空格", 'a"b', "a&b", "%PATH%", "!value!", "C:\\目录\\末尾\\", "$(echo value)"];
  const result = await execute(process.execPath, ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", ...args], { cwd: directory });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test("Skill 环境过滤混合大小写的私密变量，并正确覆盖 Windows Path", () => {
  const environment = skillEnvironment({
    Capsule_Token: "private", capsule_lease_token: "lease", Capsule_Onlyoffice_Jwt_Secret: "jwt",
    Path: "old-tools", PATH: "new-tools", CAPSULE_SKILL_STATE: "state",
  });
  const names = Object.keys(environment).map((name) => name.toUpperCase());
  for (const key of ["CAPSULE_TOKEN", "CAPSULE_LEASE_TOKEN", "CAPSULE_ONLYOFFICE_JWT_SECRET"])
    assert.equal(names.includes(key), false);
  assert.equal(environment.PATH, "new-tools");
  if (process.platform === "win32") assert.equal(names.filter((key) => key === "PATH").length, 1);
  assert.equal(environment.CAPSULE_SKILL_STATE, "state");
});

const workerSource = `
import { createServer } from "node:http";
const server = createServer((_request, response) => response.end("worker"));
server.listen(0, "127.0.0.1", () => process.stdout.write(JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:" + server.address().port + "/" }) + "\\n"));
`;
const interfaceSource = `
import { spawn } from "node:child_process";
import { writeFileSync, writeSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
const worker = spawn(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(workerSource)}], { windowsHide: true, stdio: ["ignore", "pipe", "inherit"] });
let output = "";
const server = createServer((_request, response) => response.end("interface"));
worker.stdout.on("data", (chunk) => {
  output += chunk;
  if (!output.includes("\\n")) return;
  writeFileSync(join(process.env.CAPSULE_SKILL_STATE, "worker.json"), output);
  server.listen(0, "127.0.0.1", () => writeSync(3, JSON.stringify({ url: "http://127.0.0.1:" + server.address().port + "/" }) + "\\n"));
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;

test("关闭 Skill 回收入口及其后代的本机服务，并可立即释放状态目录", { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule Skill 进程-"));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const entry = join(directory, "ui.mjs");
  await writeFile(entry, interfaceSource);
  const session = spawnInterface({ name: "进程测试", commit: "test", work: directory, state: directory, uiEntry: entry });
  t.after(() => stopProcess(session));
  const url = await session.ready;
  const worker = JSON.parse(await readFile(join(directory, "worker.json"), "utf8"));
  for (const address of [url, worker.url]) {
    const response = await fetch(address, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200);
    await response.text();
  }
  session.state = "stopping";
  await stopProcess(session);
  await session.exited;
  for (const address of [url, worker.url])
    await assert.rejects(fetch(address, { signal: AbortSignal.timeout(2000) }));
  assert.equal(session.state, "stopped");
  await rm(directory, { recursive: true });
});
