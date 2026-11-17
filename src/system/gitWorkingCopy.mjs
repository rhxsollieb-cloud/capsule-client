import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "./process.mjs";
import { entryPath } from "./paths.mjs";
import { assertWindowsEntries } from "./windowsPaths.mjs";

export async function assertWorkingTree(repository, message) {
  const reported = await git(["rev-parse", "--show-toplevel"], repository);
  // Git for Windows reports C:/..., while fs.realpath returns the native path.
  if (await realpath(reported) !== await realpath(repository)) throw new Error(message);
}

export async function validateCheckoutTree(repository, commit, { platform = process.platform } = {}) {
  const listing = await git(["ls-tree", "-r", "-z", "--full-tree", commit], repository);
  const entries = [];
  for (const item of listing.split("\0").filter(Boolean)) {
    const tab = item.indexOf("\t");
    const [mode, type] = item.slice(0, tab).split(" ");
    if (tab < 0 || type !== "blob" || !["100644", "100755"].includes(mode))
      throw Object.assign(new Error("胶囊工作树仅支持普通文件，不支持符号链接或子模块"), { code: "CHECKOUT_ENTRY_UNSUPPORTED", status: 409 });
    entries.push(entryPath(item.slice(tab + 1)));
  }
  if (platform === "win32") assertWindowsEntries(entries);
}

export async function prepareWorkingCopy(repository) {
  const info = join(repository, ".git", "info");
  await mkdir(info, { recursive: true });
  // info/attributes takes precedence over capsule and user attribute rules.
  await writeFile(
    join(info, "attributes"),
    "* -text -filter -ident -working-tree-encoding\n",
  );
}
