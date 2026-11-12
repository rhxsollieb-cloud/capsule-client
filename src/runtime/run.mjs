import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { synchronize } from "../cache/sync.mjs";
import { execute, git } from "../system/process.mjs";
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
  const dependencyGroups = [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.devDependencies,
  ];
  if (dependencyGroups.some((dependencies) => Object.keys(dependencies || {}).length))
    throw new Error("此工具声明了第三方依赖；当前运行器仅支持 Node 内置模块，尚未提供依赖安装能力");
}

export async function runCapsule(api, name, args = []) {
  const synced = await synchronize(api, name);
  if (!synced.runtime || synced.runtime.engine !== "node")
    throw new Error("胶囊需要声明受支持的 runtime.engine=node 和入口");
  entryPath(synced.runtime.entry);
  const id = randomUUID();
  const directory = join(api.config.home, "runs", id);
  const snapshot = join(directory, "snapshot");
  const work = join(directory, "work");
  await mkdir(directory, { recursive: true });
  let result;
  try {
    await git(["clone", "--no-checkout", "--no-hardlinks", "--", synced.repository, snapshot]);
    await prepareWorkingCopy(snapshot);
    await git(["checkout", "--detach", synced.commit], snapshot);
    const files = join(snapshot, "files");
    await inspectFiles(files);
    await cp(files, work, { recursive: true, force: false, errorOnExist: true });
    await inspectDependencies(work);
    const entry = await regularEntry(work, synced.runtime.entry);
    const environment = { ...process.env };
    delete environment.CAPSULE_TOKEN;
    result = await execute(process.execPath, [entry, ...args], {
      cwd: work,
      check: false,
      env: environment,
    });
    result = {
      id,
      name: synced.name,
      commit: synced.commit,
      directory,
      ...result,
    };
    await writeFile(
      join(directory, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    return result;
  } catch (error) {
    const failure = {
      id,
      name: synced.name,
      commit: synced.commit,
      error: error.message,
    };
    await writeFile(
      join(directory, "result.json"),
      JSON.stringify(failure, null, 2) + "\n",
    );
    throw error;
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}
