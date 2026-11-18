import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { git, gitResult } from "../system/process.mjs";
import { assertWorkingTree, prepareWorkingCopy, validateCheckoutTree } from "../system/gitWorkingCopy.mjs";
import { capsuleName } from "../system/paths.mjs";
import { withCacheLock } from "./lock.mjs";
import { findCachedVersion, saveCachedVersion } from "./metadata.mjs";

async function exists(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("缓存仓库目录不安全，请核对本机缓存");
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

async function assertClean(repository) {
  if (await git(["status", "--porcelain", "--untracked-files=all", "--ignored"], repository))
    throw new Error("本地胶囊缓存含未提交改动，请先保留改动后再同步");
}

async function assertRepository(repository) {
  for (const [entry, directory] of [[".git", true], [".git/info", true], [".git/info/attributes", false]]) {
    let info;
    try { info = await lstat(join(repository, entry)); }
    catch (error) { if (error.code === "ENOENT" && entry !== ".git") continue; throw error; }
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()))
      throw new Error("缓存Git目录或属性位置不安全，请核对本机缓存");
  }
  await assertWorkingTree(repository, "缓存工作树指向其他目录，同步已停止");
}

async function verifyVersion(repository, commit) {
  if (await git(["rev-parse", "--verify", commit + "^{commit}"], repository) !== commit)
    throw new Error("缓存对象与服务端提交号不一致");
  try { await git(["fsck", "--full", "--no-reflogs", "--no-dangling", commit], repository); }
  catch (cause) {
    const output = typeof cause.stdout === "string" ? cause.stdout.trim().slice(0, 2048) : "";
    throw new Error(`缓存Git对象缺失或损坏，或完整性检查未能完成，已停止同步，请核对本机缓存：${cause.message}${output ? "\n" + output : ""}`, { cause });
  }
}

async function hasCommit(repository, commit) {
  return (await gitResult(["cat-file", "-e", commit + "^{commit}"], repository, { check: false })).exitCode === 0;
}

async function importBundle(api, capsule, bundle, target, present, base) {
  try { await api.download(api.path(capsule.name, "bundle", { commit: capsule.commit, ...(base ? { base } : {}) }), bundle); }
  catch (error) {
    // Only an old server's explicit unknown-field response permits this read-only full-bundle retry.
    if (!base || error.status !== 400 || error.code !== "BAD_REQUEST" || !error.message?.includes("请求包含不支持的字段")) throw error;
    await api.download(api.path(capsule.name, "bundle", { commit: capsule.commit }), bundle);
  }
  const heads = (await git(["bundle", "list-heads", bundle], present ? target : undefined)).split("\n");
  if (!heads.length || heads.some((line) => line.split(" ")[0] !== capsule.commit))
    throw new Error("下载包未指向服务端指定的精确提交，同步已停止");
  if (present) {
    await git(["bundle", "verify", bundle], target);
    await git(["fetch", "--no-tags", bundle, capsule.commit], target);
  }
  else await git(["clone", "--no-checkout", "--", bundle, target]);
}

export async function synchronize(api, name, { kind } = {}) {
  const requested = capsuleName(name);
  const directory = cacheDirectory(api.config, requested);
  return withCacheLock(directory + ".lock", async () => {
    // This single stat, taken after the cross-process lock, is the synchronization baseline.
    const capsule = structuredClone(await api.json(api.path(requested)));
    if (capsule.name !== requested) throw new Error("服务端返回了不同名称的胶囊，同步已停止");
    assertCommit(capsule.commit);
    if (kind && capsule.kind !== kind) throw new Error(`仅 ${kind} 类别的胶囊可以执行此操作`);
    await mkdir(directory, { recursive: true });
    await exists(directory);
    const repository = join(directory, "repository");
    const present = await exists(repository);
    let previous;
    if (present) {
      await assertRepository(repository);
      await prepareWorkingCopy(repository);
      await assertClean(repository);
      previous = await git(["rev-parse", "HEAD"], repository);
      await verifyVersion(repository, previous);
      if (previous !== capsule.commit && !await findCachedVersion(api.config, capsule.name, previous))
        throw new Error("本地缓存HEAD并非已登记的服务端提交，请先保留本地提交后核对缓存");
    }
    const temporary = await mkdtemp(join(directory, ".sync-"));
    let published = false;
    try {
      const target = present ? repository : join(temporary, "repository");
      if (!present || !await hasCommit(repository, capsule.commit)) {
        if (present && await findCachedVersion(api.config, capsule.name, capsule.commit))
          throw new Error("该提交已登记缓存但Git对象缺失，请核对损坏的本机缓存");
        await importBundle(api, capsule, join(temporary, "capsule.bundle"), target, present, previous);
      }
      if (!present) { await assertRepository(target); await prepareWorkingCopy(target); }
      if (previous !== capsule.commit) await verifyVersion(target, capsule.commit);
      await validateCheckoutTree(target, capsule.commit);
      // Keep every successfully verified version reachable for exact historical consumers.
      await git(["update-ref", `refs/capsule-cache/${capsule.commit}`, capsule.commit], target);
      if (previous !== capsule.commit) await git(["checkout", "--detach", capsule.commit], target);
      if (await git(["rev-parse", "HEAD"], target) !== capsule.commit)
        throw new Error("本地版本校验失败");
      await assertClean(target);
      if (!present) { await rename(target, repository); published = true; }
      await saveCachedVersion(api.config, capsule, repository);
      return { ...capsule, repository, changed: previous !== capsule.commit };
    } catch (error) {
      if (error.cachePublished) throw error;
      if (present && previous) {
        try {
          await git(["checkout", "--detach", previous], repository);
        } catch (recoveryError) {
          throw new AggregateError(
            [error, recoveryError],
            `同步失败且恢复原版本失败：${error.message}；${recoveryError.message}`,
          );
        }
      } else if (published) {
        try {
          await assertClean(repository);
          await rename(repository, join(temporary, "repository"));
        } catch (recoveryError) {
          throw new AggregateError([error, recoveryError], `同步失败且撤回新缓存失败，已保留现场：${error.message}；${recoveryError.message}`);
        }
      }
      throw error;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
