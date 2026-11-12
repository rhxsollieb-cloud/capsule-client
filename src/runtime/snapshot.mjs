import { cp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../system/process.mjs";
import { prepareWorkingCopy } from "../system/gitWorkingCopy.mjs";
import { entryPath, regularEntry } from "../system/paths.mjs";

async function inspectFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
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

export async function prepareRun(synced, directory) {
  if (synced.kind !== "code") throw new Error("仅 code 类别的胶囊可以运行");
  if (!synced.runtime || synced.runtime.engine !== "node")
    throw new Error("胶囊需要声明受支持的 runtime.engine=node 和入口");
  entryPath(synced.runtime.entry);
  const snapshot = join(directory, "snapshot");
  const work = join(directory, "work");
  await git(["clone", "--no-checkout", "--no-hardlinks", "--", synced.repository, snapshot]);
  await prepareWorkingCopy(snapshot);
  await git(["checkout", "--detach", synced.commit], snapshot);
  const manifestPath = await regularEntry(snapshot, "cap.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest.format !== 2 ||
    manifest.name !== synced.name ||
    manifest.kind !== "code" ||
    manifest.runtime?.engine !== synced.runtime.engine ||
    manifest.runtime?.entry !== synced.runtime.entry
  )
    throw new Error("同步提交中的 cap.json 与服务端运行声明不一致");
  const files = join(snapshot, "files");
  await inspectFiles(files);
  await cp(files, work, { recursive: true, force: false, errorOnExist: true });
  await inspectDependencies(work);
  return { entry: await regularEntry(work, manifest.runtime.entry), work };
}
