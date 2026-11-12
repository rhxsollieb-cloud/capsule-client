import { cp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../system/process.mjs";
import { prepareWorkingCopy } from "../system/gitWorkingCopy.mjs";
import { entryPath, regularEntry } from "../system/paths.mjs";
import { cachedVersion } from "../cache/metadata.mjs";

async function inspectFiles(directory, root = false) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (root && entry.name === ".git") continue;
    if (entry.isSymbolicLink()) throw new Error("运行文件中包含符号链接");
    if (entry.isDirectory()) await inspectFiles(join(directory, entry.name));
    else if (!entry.isFile()) throw new Error("运行文件必须为普通文件");
  }
}

async function inspectDependencies(directory) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const groups = [manifest.dependencies, manifest.optionalDependencies, manifest.devDependencies];
  if (groups.some((dependencies) => Object.keys(dependencies || {}).length))
    throw new Error("此工具声明了第三方依赖；当前运行器仅支持 Node 内置模块，尚未提供依赖安装能力");
}

export async function prepareRun(config, synced, directory) {
  const version = await cachedVersion(config, synced.name, synced.commit);
  if (version.repository !== synced.repository)
    throw new Error("缓存仓库与该提交的元数据不一致");
  if (version.kind !== "code") throw new Error("仅 code 类别的胶囊可以运行");
  if (!version.runtime || version.runtime.engine !== "node")
    throw new Error("胶囊需要声明受支持的 runtime.engine=node 和入口");
  entryPath(version.runtime.entry);
  const snapshot = join(directory, "snapshot");
  const work = join(directory, "work");
  await git(["clone", "--no-checkout", "--no-hardlinks", "--", synced.repository, snapshot]);
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
  await inspectDependencies(work);
  return { entry: await regularEntry(work, version.runtime.entry), work };
}
