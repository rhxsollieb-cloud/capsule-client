import { extname } from "node:path";
import { capsuleName, entryPath } from "../system/paths.mjs";
import { officeParts } from "./archive.mjs";
import { excelPreview } from "./excel.mjs";
import { wordPreview } from "./word.mjs";
import { limits, previewError } from "./limits.mjs";

export async function parseOffice(buffer, kind) {
  if (!["word", "excel"].includes(kind)) throw previewError("不支持的办公预览格式", 415);
  const parts = await officeParts(buffer, kind);
  return kind === "word" ? wordPreview(parts) : excelPreview(parts);
}

async function contentBuffer(response) {
  const declared = response.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limits.fileBytes)) {
    await response.body?.cancel();
    throw previewError("办公原件超过 16 MiB 预览上限", 413);
  }
  if (!response.body) throw previewError("原件内容为空");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limits.fileBytes) {
        await reader.cancel();
        throw previewError("办公原件超过 16 MiB 预览上限", 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function previewOffice(api, name, entry) {
  name = capsuleName(name);
  if (entry !== undefined) entry = entryPath(entry);
  const extension = extname(entry || name).toLowerCase();
  const kind = extension === ".docx" ? "word" : extension === ".xlsx" ? "excel" : undefined;
  if (!kind) throw previewError("当前办公预览支持 .docx 和 .xlsx，请下载原件查看其他格式", 415);
  const before = await api.json(api.path(name));
  const source = await api.response(api.path(name, "content", { entry }));
  const buffer = await contentBuffer(source);
  const after = await api.json(api.path(name));
  if (before.commit !== after.commit)
    throw previewError("读取期间版本已变化，请刷新后重新预览", 409);
  return { name, ...(entry === undefined ? {} : { entry }), commit: before.commit, ...await parseOffice(buffer, kind) };
}
