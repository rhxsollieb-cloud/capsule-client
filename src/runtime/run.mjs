import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { synchronize } from "../cache/sync.mjs";
import { execute } from "../system/process.mjs";
import { prepareRun } from "./snapshot.mjs";
import { saveRun } from "./logs.mjs";
import { saveRemoteRun } from "./remoteLogs.mjs";

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
    const environment = { ...process.env };
    delete environment.CAPSULE_TOKEN;
    const execution = await execute(process.execPath, [prepared.entry, ...args], {
      cwd: prepared.work,
      check: false,
      env: environment,
    });
    result = { ...identity, ...execution };
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
