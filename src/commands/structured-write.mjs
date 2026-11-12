import { readFile, stat } from "node:fs/promises";
import { writeOffice } from "../office/write.mjs";
import { writeTable } from "../database/tables.mjs";

async function changesFile(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error("修改文件需要不超过 1 MiB 的 JSON 普通文件");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error("修改文件需要有效 JSON");
  }
}

export async function structuredWriteCommand(api, { command, positional, values }) {
  const changes = await changesFile(values.file);
  const name = positional[0];
  if (command === "table-write")
    return writeTable(api, name, { table: positional[1], changes, token: values.token });
  return writeOffice(api, name, { entry: positional[1], changes, token: values.token });
}
