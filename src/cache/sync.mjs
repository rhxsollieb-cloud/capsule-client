import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../system/process.mjs";
import { prepareWorkingCopy } from "../system/gitWorkingCopy.mjs";
import { capsuleName } from "../system/paths.mjs";
import { withCacheLock } from "./lock.mjs";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function cacheDirectory(config, name) {
  const key = createHash("sha256")
    .update(config.serverUrl + "\0" + capsuleName(name))
    .digest("hex");
  return join(config.home, "cache", key);
}

function assertCommit(commit) {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(commit || ""))
    throw new Error("服务端未返回有效的完整提交号");
}

export async function synchronize(api, name) {
  const capsule = await api.json(api.path(capsuleName(name)));
  capsuleName(capsule.name);
  assertCommit(capsule.commit);
  const directory = cacheDirectory(api.config, capsule.name);
  return withCacheLock(directory + ".lock", async () => {
    await mkdir(directory, { recursive: true });
    const repository = join(directory, "repository");
    const present = await exists(repository);
    let previous;
    if (present) {
      await prepareWorkingCopy(repository);
      if (
        await git(
          ["status", "--porcelain", "--untracked-files=all", "--ignored"],
          repository,
        )
      )
        throw new Error("本地胶囊缓存含未提交改动，请先保留改动后再同步");
      previous = await git(["rev-parse", "HEAD"], repository);
      if (previous === capsule.commit)
        return { ...capsule, repository, changed: false };
    }
    const temporary = await mkdtemp(join(directory, ".sync-"));
    try {
      const bundle = join(temporary, "capsule.bundle");
      await api.download(
        api.path(capsule.name, "bundle", { commit: capsule.commit }),
        bundle,
      );
      const target = present ? repository : join(temporary, "repository");
      if (present)
        await git(
          ["fetch", "--no-tags", bundle, "+refs/heads/*:refs/capsule-sync/*"],
          repository,
        );
      else
        await git(["clone", "--no-checkout", "--", bundle, target]);
      await prepareWorkingCopy(target);
      const verified = await git(
        ["rev-parse", "--verify", capsule.commit + "^{commit}"],
        target,
      );
      if (verified !== capsule.commit)
        throw new Error("下载版本与服务端提交号不一致");
      await git(["checkout", "--detach", capsule.commit], target);
      if (await git(["rev-parse", "HEAD"], target) !== capsule.commit)
        throw new Error("本地版本校验失败");
      if (!present) await rename(target, repository);
      const state = {
        name: capsule.name,
        serverUrl: api.config.serverUrl,
        commit: capsule.commit,
      };
      const stateFile = join(temporary, "state.json");
      await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n");
      await rename(stateFile, join(directory, "state.json"));
      return { ...capsule, repository, changed: true };
    } catch (error) {
      if (present && previous) {
        try {
          await git(["checkout", "--detach", previous], repository);
        } catch (recoveryError) {
          throw new AggregateError(
            [error, recoveryError],
            `同步失败且恢复原版本失败：${error.message}；${recoveryError.message}`,
          );
        }
      }
      throw error;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
