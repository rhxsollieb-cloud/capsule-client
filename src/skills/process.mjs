import { skillEnvironment } from "./environment.mjs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { signalProcessTree } from "../system/process-tree.mjs";

export function localPage(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Skill UI 未返回有效本机地址"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port || url.username || url.password)
    throw new Error("Skill UI 地址需要使用本机回环 HTTP 和明确端口");
  return url.href;
}
async function waitForExit(session, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      session.exited.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}
export async function stopProcess(session) {
  if (!session.child || !Number.isSafeInteger(session.child.pid)) return;
  if (process.platform !== "win32") {
    await signalProcessTree(session.child, "SIGTERM");
    await waitForExit(session, 1500);
  }
  // Windows requires taskkill /T; child.kill() leaves descendant servers alive.
  // POSIX descendants remain in our process group after the entry process exits.
  await signalProcessTree(session.child, "SIGKILL");
  if (!await waitForExit(session, 1500))
    throw new Error("Skill UI 进程树尚未确认退出，请核对本机进程；当前占用仍保留");
}

export function spawnInterface(record, { redact = (value) => value, onExit } = {}) {
  const environment = skillEnvironment({ CAPSULE_SKILL_STATE: record.state, CAPSULE_SKILL_NAME: record.name,
    CAPSULE_SKILL_COMMIT: record.commit, CAPSULE_SKILL_READY_FD: "3" });
  const child = spawn(process.execPath, [record.uiEntry], {
    cwd: record.work, env: environment, shell: false,
    windowsHide: true,
    detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "pipe"],
  });
  const session = { id: randomUUID(), child, state: "starting", output: "", startedAt: new Date().toISOString() };
  const output = (chunk) => { session.output = redact((session.output + chunk.toString("utf8")).slice(-16384)); };
  child.stdout.on("data", output);
  child.stderr.on("data", output);
  let accept;
  let reject;
  let ready = false;
  let protocol = "";
  session.ready = new Promise((resolve, fail) => { accept = resolve; reject = fail; });
  session.ready.catch(() => {});
  const timer = setTimeout(() => reject(new Error("Skill UI 启动超时：请通过 fd 3 报告本机地址")), 15000);
  const failed = (error) => { clearTimeout(timer); reject(error); };
  child.stdio[3].on("data", (chunk) => {
    if (ready) return;
    protocol += chunk.toString("utf8");
    if (protocol.length > 16384) { failed(new Error("Skill UI 启动回执超过限制")); return; }
    const newline = protocol.indexOf("\n");
    if (newline < 0) return;
    try {
      const message = JSON.parse(protocol.slice(0, newline));
      session.url = localPage(message.url);
      ready = true;
      clearTimeout(timer);
      accept(session.url);
    } catch (error) { failed(error); }
  });
  child.stdio[3].on("error", failed);
  child.once("error", failed);
  session.exited = new Promise((resolve) => child.once("close", async (exitCode, exitSignal) => {
    clearTimeout(timer);
    session.exitCode = exitCode;
    session.exitSignal = exitSignal;
    session.state = session.state === "failed" ? "failed" : session.state === "stopping" || exitCode === 0 ? "stopped" : "failed";
    if (session.state === "failed" && !session.error)
      session.error = redact(`Skill UI 进程退出（${exitCode ?? exitSignal}）${session.output ? `：${session.output.trim()}` : ""}`);
    if (!ready) reject(new Error(`Skill UI 未就绪即退出（${exitCode ?? exitSignal}）${session.output ? `：${session.output.trim()}` : ""}`));
    try { await onExit?.(session); }
    catch (error) { session.error = [session.error, `退出状态登记失败：${redact(error.message)}`].filter(Boolean).join("；"); }
    resolve();
  }));
  return session;
}
