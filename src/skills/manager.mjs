import { synchronize } from "../cache/sync.mjs";
import { capsuleName } from "../system/paths.mjs";
import { createOwner, peerSession } from "./peer-session.mjs";
import { CLI_ENTRY } from "./format.mjs";
import { readRegistration, saveRegistration, updateRegistrationSession } from "./registry.mjs";
import { spawnInterface, stopProcess } from "./process.mjs";
import { prepareSkillWorkspace, verifySkillWorkspace } from "./workspace.mjs";
import { withCacheLock } from "../cache/lock.mjs";
import { skillPaths } from "../storage/paths.mjs";

const failure = (message, code = "SKILL_LOCAL") => Object.assign(new Error(message), { status: 409, code });
const active = (session) => session && ["starting", "running", "stopping"].includes(session.state);
const publicSession = (session) => ({ id: session.id, state: session.state, ...(session.url ? { url: session.url } : {}),
  ...(session.child?.pid ? { pid: session.child.pid } : {}),
  startedAt: session.startedAt, ...(session.error ? { error: session.error } : {}),
  ...(session.output ? { output: session.output } : {}), ...(session.exitCode !== undefined ? { exitCode: session.exitCode } : {}) });

export class SkillManager {
  constructor(api, { shared = { sessions: new Map(), operations: new Map(), closed: false } } = {}) {
    this.api = api;
    this.config = api.config;
    this.shared = shared;
    this.sessions = shared.sessions;
    this.operations = shared.operations;
  }
  get closed() { return this.shared.closed; }
  set closed(value) { this.shared.closed = value; }
  serial(name, operation) {
    name = capsuleName(name);
    if (this.closed) throw failure("本机 Skill 服务正在关闭");
    const previous = this.operations.get(name) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => this.lifecycle(name, operation));
    this.operations.set(name, current);
    current.finally(() => { if (this.operations.get(name) === current) this.operations.delete(name); }).catch(() => {});
    return current;
  }
  async lifecycle(name, operation) {
    try { return await withCacheLock(skillPaths(this.config, name).directory + ".lifecycle.lock", operation, { timeoutMs: 0 }); }
    catch (error) {
      if (error.code === "CACHE_BUSY") throw failure("另一个本机客户端正在注册、启动或关闭此Skill，请查询原状态后重试", "SKILL_BUSY");
      throw error;
    }
  }
  register(name) { name = capsuleName(name); return this.serial(name, () => this.registerNow(name)); }
  async registerNow(name) {
    const synced = await synchronize(this.api, name, { kind: "code" });
    const previous = await readRegistration(this.config, name);
    if (previous?.lastSession?.id !== this.sessions.get(name)?.id && previous?.lastSession && ["starting", "running", "stopping", "unknown"].includes(previous.lastSession.state))
      throw failure("上次 Skill UI 会话尚未核对，请先关闭旧进程并使用 skill-stop 重置旧登记", "SKILL_SESSION_UNKNOWN");
    if (previous) await verifySkillWorkspace(previous);
    if (active(this.sessions.get(name))) {
      if (previous?.commit === synced.commit) return this.status(name);
      throw failure("Skill UI 正在运行旧提交，请先停止再注册新版本", "SKILL_UPDATE_PENDING");
    }
    const record = await prepareSkillWorkspace(this.config, synced);
    await saveRegistration(this.config, record);
    this.sessions.delete(name);
    return this.status(name);
  }
  async status(name, principal, cap) {
    name = capsuleName(name);
    const record = await readRegistration(this.config, name);
    let latest;
    let serverError;
    try {
      latest = cap ?? await this.api.json(this.api.path(name));
    } catch (error) { serverError = this.api.redact(error.message); }
    if (latest && latest.kind !== "code") {
      if (!record) throw failure("只有代码 Skill 可以注册到本机", "SKILL_KIND");
      serverError = "服务端同名实体已不是代码 Skill；本机原会话仍可停止与核对";
      latest = undefined;
    }
    const previousState = record?.lastSession;
    const local = this.sessions.get(name);
    const session = local && (!previousState || local.id === previousState.id) ? local : undefined;
    const peer = !session && await peerSession(record, principal);
    const state = peer ? "running" : session ? session.state : previousState && ["running", "starting", "stopping"].includes(previousState.state) ? "unknown" : record ? "registered" : "unregistered";
    return { name, registered: Boolean(record), state,
      ...(typeof latest?.hasUI === "boolean" ? { latestHasUI: latest.hasUI, hasUI: latest.hasUI } : {}),
      ...(latest ? { latestCommit: latest.commit, needsConversion: latest.runtime?.engine !== "node" || latest.runtime?.entry !== CLI_ENTRY } : {}),
      ...(serverError ? { serverError } : {}),
      ...(record ? { commit: record.commit, skillName: record.skillName, description: record.description,
        hasUI: Boolean(record.uiEntry), updateAvailable: latest ? latest.commit !== record.commit : null,
        cli: { command: process.execPath, entry: record.entry, cwd: record.work, state: record.state } } : {}),
      ...(peer ? { session: peer, peer: true } : session ? { session: publicSession(session) } : previousState ? { lastSession: previousState } : {}),
    };
  }
  start(name, principal) {
    name = capsuleName(name);
    return this.serial(name, async () => {
      if (active(this.sessions.get(name))) return this.status(name);
      const existing = await readRegistration(this.config, name);
      if (await peerSession(existing, principal)) return this.status(name, principal);
      await this.registerNow(name);
      const record = await readRegistration(this.config, name);
      if (!record.uiEntry) throw failure("此 Skill 没有 scripts/ui.mjs；直接使用独立 CLI 即可", "SKILL_NO_UI");
      await verifySkillWorkspace(record);
      const session = spawnInterface(record, { redact: (value) => this.api.redact(value), onExit: async (finished) => {
        await updateRegistrationSession(this.config, name, finished.id, publicSession(finished));
      } });
      session.owner = createOwner(this.shared.ownerPort, principal, this.shared.ownerIPv6);
      record.owner = session.owner;
      this.sessions.set(name, session);
      try {
        await saveRegistration(this.config, { ...record, lastSession: publicSession(session) });
        const url = await session.ready;
        const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
        await response.body?.cancel();
        if (!response.ok) throw new Error(`Skill UI 地址尚不可浏览（HTTP ${response.status}）`);
        if (session.state !== "starting") throw new Error("Skill UI 在就绪后退出");
        session.state = "running";
        await saveRegistration(this.config, { ...record, lastSession: publicSession(session) });
        return this.status(name);
      } catch (error) {
        session.error = this.api.redact(error.message);
        session.state = "failed";
        try { await stopProcess(session); }
        catch (stopping) { session.error += `；停止进程未确认：${this.api.redact(stopping.message)}`; }
        try { await saveRegistration(this.config, { ...record, lastSession: publicSession(session) }); }
        catch (saving) { session.error += `；状态登记未保存：${this.api.redact(saving.message)}`; }
        throw Object.assign(new Error(session.error), { status: 409, code: "SKILL_UI_FAILED" });
      }
    });
  }
  stop(name) { name = capsuleName(name); return this.serial(name, async () => { await this.stopNow(name); return this.status(name); }); }
  async stopNow(name) {
    const session = this.sessions.get(name);
    if (!session) {
      const record = await readRegistration(this.config, name);
      if (record?.lastSession && ["starting", "running", "stopping", "unknown"].includes(record.lastSession.state)) {
        if (record.lastSession.url) {
          let response;
          try { response = await fetch(record.lastSession.url, { redirect: "manual", signal: AbortSignal.timeout(2000) }); }
          catch (error) { if (error.cause?.code !== "ECONNREFUSED") throw failure("旧页面状态无法确认，请先核对原本机进程", "SKILL_SESSION_UNKNOWN"); }
          if (response) { await response.body?.cancel(); throw failure("旧页面仍可访问，当前客户端不会按旧 PID 终止它；请先关闭原进程", "SKILL_SESSION_UNKNOWN"); }
        }
        await saveRegistration(this.config, { ...record, lastSession: { ...record.lastSession, state: "stopped", error: "旧会话不属于当前进程；仅重置了本机登记，请核对原进程已关闭。" } });
      }
      return;
    }
    if (!active(session) && (session.child?.exitCode !== null || session.child?.signalCode !== null)) return;
    session.state = "stopping";
    await stopProcess(session);
    session.state = "stopped";
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.operations.values()]);
    const pending = [...this.sessions].filter(([, session]) => active(session) || session.child?.exitCode === null && session.child?.signalCode === null);
    const stopped = await Promise.allSettled(pending.map(([name]) => this.lifecycle(name, () => this.stopNow(name))));
    const failed = stopped.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}
