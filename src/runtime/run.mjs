import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { synchronize } from "../cache/sync.mjs";
import { execute } from "../system/process.mjs";
import { prepareRun } from "./snapshot.mjs";
import { saveRun } from "./logs.mjs";
import { saveRemoteRun } from "./remoteLogs.mjs";
import { skillPaths } from "../storage/paths.mjs";
import { skillEnvironment } from "../skills/environment.mjs";
import { readRegistration } from "../skills/registry.mjs";

const activeInterfaceStates = new Set(["running", "starting", "stopping", "unknown"]);

async function recordResult(api, result, logCap) {
  const errors = {};
  let localSaved = false;
  try {
    const saved = await saveRun(api.config.home, result);
    result.logDatabase = saved.database;
    localSaved = true;
  } catch (error) {
    errors.local = error.message;
  }
  if (logCap) {
    try {
      const saved = await saveRemoteRun(api, logCap, result);
      result.logCap = { name: logCap, commit: saved.commit };
    } catch (error) {
      errors.remote = error.message;
      if (error.eventId) result.logCap = { name: logCap, eventId: error.eventId };
    }
  }
  if (Object.keys(errors).length) result.logError = errors;
  if (logCap && localSaved) {
    try {
      await saveRun(api.config.home, result);
    } catch (error) {
      errors.local = error.message;
      result.logError = errors;
    }
  }
  return result;
}

export async function runCapsule(api, name, args = [], { logCap } = {}) {
  const synced = await synchronize(api, name, { kind: "code" });
  const registration = await readRegistration(api.config, synced.name);
  if (activeInterfaceStates.has(registration?.lastSession?.state) && registration.commit !== synced.commit)
    throw Object.assign(new Error("此skill的旧UI仍在运行或状态未确认，CLI与UI必须使用同一提交；请先使用skill-stop停止，再用skill-register注册最新版本后运行"), { status: 409, code: "SKILL_UPDATE_PENDING" });
  const id = randomUUID();
  const directory = join(api.config.home, "runs", id);
  await mkdir(directory, { recursive: true });
  const identity = {
    id,
    name: synced.name,
    commit: synced.commit,
    directory,
    createdAt: new Date().toISOString(),
  };
  let result;
  let executionError;
  try {
    const prepared = await prepareRun(api.config, synced, directory);
    const paths = skillPaths(api.config, synced.name);
    await mkdir(paths.state, { recursive: true });
    const environment = skillEnvironment({ CAPSULE_SKILL_STATE: paths.state });
    const execution = await execute(process.execPath, [prepared.entry, ...args], {
      cwd: prepared.work,
      check: false,
      env: environment,
    });
    result = { ...identity, ...execution };
    if (execution.exitCode && /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ModuleNotFoundError|No module named|command not found|spawn .+ ENOENT/.test(execution.stderr))
      result.stderr += "\n[Capsule] skill缺少模块或本机工具。请按SKILL.md核对依赖和路径；客户端不会自动安装。\n";
  } catch (error) {
    executionError = error;
    result = { ...identity, error: error.message };
  } finally {
    await rm(join(directory, "snapshot"), { recursive: true, force: true });
  }
  await recordResult(api, result, logCap);
  if (executionError) {
    executionError.result = result;
    throw executionError;
  }
  return result;
}
