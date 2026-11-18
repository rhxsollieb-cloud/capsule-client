import { lstat, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execute } from "../system/process.mjs";
import { entryPath } from "../system/paths.mjs";
import { assertWindowsEntries } from "../system/windowsPaths.mjs";

const excluded = new Set([".git", ".local", "node_modules", ".env", "connection.sqlite", "connection.sqlite-wal", "connection.sqlite-shm"]);
const signature = (value) => `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`;

async function inventory(root, kind) {
  const files = [];
  const manifest = new Map();
  let bytes = 0;
  const walk = async (parent, prefix = "") => {
    for (const item of await readdir(parent, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      entryPath(path);
      if (excluded.has(item.name)) throw new Error(`导入目录包含运行、凭据或仓库文件：${path}；请准备干净目录，不会自动略过。`);
      if (kind !== "code" && !(path === (kind === "markdown" ? "README.md" : "说明.md") || path === "assets" || path.startsWith("assets/")))
        throw new Error(`${kind}导入仅接受正文及assets/：${path}`);
      const file = join(parent, item.name);
      const info = await lstat(file, { bigint: true });
      if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) throw new Error(`导入拒绝链接和特殊文件：${path}`);
      if (manifest.size >= 10000) throw new Error("导入路径数量超过10000上限");
      manifest.set(path, `${info.isDirectory() ? "directory" : "file"}:${signature(info)}`);
      if (info.isDirectory()) await walk(file, path);
      else {
        if (info.nlink > 1n) throw new Error(`导入拒绝硬链接：${path}`);
        bytes += Number(info.size);
        if (info.size > 512n * 1024n * 1024n || bytes > 2 * 1024 * 1024 * 1024 || files.length >= 10000)
          throw new Error("导入超过单文件512MiB、总文件2GiB或10000文件上限");
        files.push({ path, file, signature: signature(info) });
      }
    }
  };
  await walk(root);
  const required = kind === "code" ? ["SKILL.md", "scripts/cli.mjs"] : [kind === "markdown" ? "README.md" : "说明.md"];
  for (const path of required) if (!files.some((file) => file.path === path)) throw new Error(`导入缺少 ${path}`);
  assertWindowsEntries(files.map((file) => file.path));
  return { files, manifest };
}

async function tarCommand(run) {
  const candidates = ["tar"];
  if (process.platform === "win32") {
    try { candidates.push(resolve((await run("git", ["--exec-path"], { maxOutput: 32768 })).stdout.trim(), "../../../usr/bin/tar.exe")); }
    catch { /* Windows includes tar; Git's copy is the fallback. */ }
    for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs")].filter(Boolean))
      candidates.push(join(base, "Git", "usr", "bin", "tar.exe"));
  }
  for (const candidate of candidates) {
    try { await run(candidate, ["--version"], { maxOutput: 32768 }); return candidate; }
    catch { /* Try another installed system/Git tar; never install tools. */ }
  }
  throw new Error("未找到系统或Git for Windows附带的tar，请核对Git安装和PATH。");
}

export async function inspectImportDirectory(directory, kind) {
  const root = resolve(directory);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("导入源必须是实际本地目录，不能是链接");
  return inventory(root, kind);
}

export async function archiveDirectory(directory, target, kind, { run = execute } = {}) {
  const root = resolve(directory);
  const { files, manifest } = await inspectImportDirectory(root, kind);
  const tar = await tarCommand(run);
  const names = (await readdir(root)).sort();
  await run(tar, ["--format=pax", "--no-xattrs", "-cf", target, "-C", root, "--", ...names], {
    env: { ...process.env, COPYFILE_DISABLE: "1" }, maxOutput: 1024 * 1024,
  });
  for (const file of files) {
    const current = await lstat(file.file, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() || signature(current) !== file.signature)
      throw new Error(`归档期间源文件变化，未发送导入：${file.path}`);
  }
  const after = (await inventory(root, kind)).manifest;
  if (after.size !== manifest.size || [...after].some(([path, value]) => manifest.get(path) !== value))
    throw new Error("归档期间目录内容变化，未发送导入");
  return { file: target, size: (await stat(target)).size };
}
