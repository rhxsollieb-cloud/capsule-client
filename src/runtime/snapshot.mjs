import { cp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../system/process.mjs";
import { prepareWorkingCopy } from "../system/gitWorkingCopy.mjs";
import { snapshotCachedVersion } from "../cache/snapshot.mjs";
import { loadSkill, CLI_ENTRY } from "../skills/format.mjs";

async function inspectFiles(directory, root = false) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (root && entry.name === ".git") continue;
    if (entry.isSymbolicLink()) throw new Error("运行文件中包含符号链接");
    if (entry.isDirectory()) await inspectFiles(join(directory, entry.name));
    else if (!entry.isFile()) throw new Error("运行文件必须为普通文件");
  }
}

export async function prepareRun(config, synced, directory) {
  const snapshot = join(directory, "snapshot");
  const work = join(directory, "work");
  const version = await snapshotCachedVersion(config, synced, snapshot);
  if (version.kind !== "code") throw new Error("仅 code 类别的胶囊可以运行");
  if (version.runtime?.engine !== "node" || version.runtime.entry !== CLI_ENTRY)
    throw new Error("代码cap仅支持skill固定入口node/scripts/cli.mjs，请将旧运行入口整理为skill格式");
  await prepareWorkingCopy(snapshot);
  await git(["checkout", "--detach", synced.commit], snapshot);
  if (await git(["rev-parse", "HEAD"], snapshot) !== version.commit)
    throw new Error("运行快照与缓存元数据提交不一致");
  await inspectFiles(snapshot, true);
  await cp(snapshot, work, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (source) => source !== join(snapshot, ".git"),
  });
  const { entry, ...skill } = await loadSkill(work);
  return { entry, work, skill };
}
