import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function prepareWorkingCopy(repository) {
  const info = join(repository, ".git", "info");
  await mkdir(info, { recursive: true });
  // info/attributes takes precedence over capsule and user attribute rules.
  await writeFile(
    join(info, "attributes"),
    "* -text -filter -ident -working-tree-encoding\n",
  );
}
