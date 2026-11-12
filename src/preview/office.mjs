import { readOfficeSource } from "../office/source.mjs";
import { inspectOfficeArchive } from "./archive.mjs";
import { excelPreview } from "./excel.mjs";
import { wordPreview } from "./word.mjs";
import { previewError } from "./limits.mjs";

export async function parseOffice(buffer, kind) {
  if (!["word", "excel"].includes(kind)) throw previewError("不支持的办公预览格式", 415);
  await inspectOfficeArchive(buffer);
  return kind === "word" ? wordPreview(buffer) : excelPreview(buffer);
}

export async function previewOffice(api, name, entry) {
  const source = await readOfficeSource(api, name, entry);
  return {
    name: source.name,
    ...(source.entry === undefined ? {} : { entry: source.entry }),
    commit: source.record.commit,
    ...await parseOffice(source.buffer, source.kind),
  };
}
