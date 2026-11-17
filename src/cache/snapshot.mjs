import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../system/process.mjs";
import { cacheDirectory } from "./sync.mjs";
import { withCacheLock } from "./lock.mjs";
import { cachedVersion } from "./metadata.mjs";
import { assertWorkingTree } from "../system/gitWorkingCopy.mjs";

export async function snapshotCachedVersion(config, synced, destination) {
  const directory = cacheDirectory(config, synced.name);
  const repository = join(directory, "repository");
  if (synced.repository !== repository) throw new Error("缓存仓库路径与胶囊身份不一致");
  return withCacheLock(directory + ".lock", async () => {
    const version = await cachedVersion(config, synced.name, synced.commit);
    if (version.repository !== repository) throw new Error("缓存仓库与该提交的元数据不一致");
    for (const path of [repository, join(repository, ".git")]) {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("缓存仓库位置被替换，请核对后重新同步");
    }
    await assertWorkingTree(repository, "缓存工作树指向其他目录，已停止创建运行快照");
    if (await git(["status", "--porcelain", "--untracked-files=all", "--ignored"], repository))
      throw new Error("本地胶囊缓存含未提交改动，请先保留改动后再运行");
    if (await git(["rev-parse", "--verify", synced.commit + "^{commit}"], repository) !== synced.commit)
      throw new Error("运行所需的精确提交不在本地缓存，请重新同步");
    await git(["clone", "--no-checkout", "--no-hardlinks", "--", repository, destination]);
    if (await git(["rev-parse", "--verify", synced.commit + "^{commit}"], destination) !== version.commit)
      throw new Error("运行快照与缓存元数据提交不一致");
    return version;
  });
}
