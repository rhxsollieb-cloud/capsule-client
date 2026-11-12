import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readOfficeSource } from "./source.mjs";
import { patchExcel } from "./excel.mjs";
import { patchWord } from "./word.mjs";
import { inspectOfficeArchive } from "../preview/archive.mjs";
import { previewError } from "../preview/limits.mjs";

export async function writeOffice(api, name, { entry, changes, token } = {}) {
  if (typeof token !== "string" || !token) throw previewError("办公写入需要当前版本 token", 400);
  const source = await readOfficeSource(api, name, entry, token);
  await inspectOfficeArchive(source.buffer);
  const output = source.kind === "excel"
    ? await patchExcel(source.buffer, changes)
    : await patchWord(source.buffer, changes);
  await inspectOfficeArchive(output);
  const staging = join(api.config.home, "uploads");
  await mkdir(staging, { recursive: true });
  const temporary = await mkdtemp(join(staging, "office-"));
  try {
    const file = join(temporary, "content");
    await writeFile(file, output, { flag: "wx" });
    return await api.upload(source.name, source.entry, file, token);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
