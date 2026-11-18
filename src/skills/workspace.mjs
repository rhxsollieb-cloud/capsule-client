import { skillPaths } from "../storage/paths.mjs";
import { lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { prepareRun } from "../runtime/snapshot.mjs";
import { regularEntry } from "../system/paths.mjs";
import { git } from "../system/process.mjs";
import { loadSkill, CLI_ENTRY, UI_ENTRY } from "./format.mjs";
import { withCacheLock } from "../cache/lock.mjs";

const invalid = (message) => Object.assign(new Error(message), { status: 409, code: "SKILL_WORKSPACE" });

export async function verifySkillWorkspace(record) {
  for (const path of [record.work, record.snapshot]) {
    const saved = await lstat(path);
    if (!saved.isDirectory() || saved.isSymbolicLink()) throw invalid("Skill 工作目录被替换，请核对本机注册");
  }
  if (await git(["rev-parse", "HEAD"], record.snapshot) !== record.commit) throw invalid("本机 Skill 快照版本已变化，请核对后重新注册");
  if (await git(["status", "--porcelain", "--untracked-files=all", "--ignored"], record.snapshot)) throw invalid("本机 Skill 版本快照含未提交改动，请先核对");
  const listing = await git(["ls-tree", "-r", "-z", "HEAD"], record.snapshot);
  for (const item of listing.split("\0").filter(Boolean)) {
    const tab = item.indexOf("\t");
    const [mode, type, expected] = item.slice(0, tab).split(" ");
    const entry = item.slice(tab + 1);
    if (tab < 0 || type !== "blob" || !["100644", "100755"].includes(mode)) throw invalid("Skill 快照包含不受支持的受管条目");
    const working = await regularEntry(record.work, entry);
    // Git hashes the file as a stream, using the repository's object format.
    const actual = await git(["hash-object", "--no-filters", "--", working], record.snapshot);
    if (actual !== expected) throw invalid(`本机 Skill 受管代码有修改：${entry}；请先保存到 cap，勿覆盖本机改动`);
  }
  return loadSkill(record.work);
}

export async function prepareSkillWorkspace(config, synced) {
  const paths = skillPaths(config, synced.name);
  await mkdir(paths.directory, { recursive: true });
  await mkdir(paths.state, { recursive: true });
  const directory = join(paths.directory, "versions", synced.commit);
  await mkdir(join(paths.directory, "versions"), { recursive: true });
  return withCacheLock(directory + ".lock", () => prepareVersion(config, synced, paths, directory));
}

async function prepareVersion(config, synced, paths, directory) {
  let exists = false;
  try {
    const saved = await lstat(directory);
    if (saved.isSymbolicLink() || !saved.isDirectory()) throw invalid("本机 Skill 版本目录不安全");
    exists = true;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!exists) {
    const temporary = await mkdtemp(join(paths.directory, ".register-"));
    try { await prepareRun(config, synced, temporary); await rename(temporary, directory); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  }
  const work = join(directory, "work");
  const skill = await loadSkill(work);
  const record = { name: synced.name, commit: synced.commit, skillName: skill.name, description: skill.description,
    work, snapshot: join(directory, "snapshot"), entry: join(work, CLI_ENTRY),
    ...(skill.uiEntry ? { uiEntry: join(work, UI_ENTRY) } : {}), state: paths.state,
    registeredAt: new Date().toISOString() };
  await verifySkillWorkspace(record);
  return record;
}
