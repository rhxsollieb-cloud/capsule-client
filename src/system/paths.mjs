import { lstat, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { assertWindowsEntries } from "./windowsPaths.mjs";

export function capsuleName(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > 180 ||
    /[\\/:*?"<>|\x00-\x1f\x7f]/u.test(value) ||
    value.startsWith(".") ||
    value.endsWith(".") ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value)
  )
    throw new Error("胶囊名称必须是安全、非空的单个名称");
  return value.normalize("NFC");
}

export function entryPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    /[\\\x00-\x1f\x7f]/u.test(value) ||
    value.split("/").some((part) => !part || [".", ".."].includes(part))
  )
    throw new Error("内部条目必须是安全的相对路径");
  return value;
}

export async function regularEntry(root, entry) {
  entryPath(entry);
  if (process.platform === "win32") assertWindowsEntries([entry]);
  const base = await realpath(root);
  let current = base;
  for (const part of entry.split("/")) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("内部条目不能包含符号链接");
  }
  const delta = relative(base, current);
  if (
    isAbsolute(delta) ||
    delta === ".." ||
    delta.startsWith(".." + sep) ||
    !(await lstat(current)).isFile()
  )
    throw new Error("内容必须位于胶囊根目录内且为普通文件");
  return current;
}
