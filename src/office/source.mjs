import { extname } from "node:path";
import { capsuleName, entryPath } from "../system/paths.mjs";
import { limits, previewError } from "../preview/limits.mjs";

async function contentBuffer(response) {
  const declared = response.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limits.fileBytes)) {
    await response.body?.cancel();
    throw previewError("办公原件超过 16 MiB 上限", 413);
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
        throw previewError("办公原件超过 16 MiB 上限", 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function readOfficeSource(api, name, entry, token) {
  name = capsuleName(name);
  if (entry !== undefined) entry = entryPath(entry);
  const extension = extname(entry || name).toLowerCase();
  const kind = extension === ".docx" ? "word" : extension === ".xlsx" ? "excel" : undefined;
  if (!kind) throw previewError("当前办公操作支持 .docx 和 .xlsx，请下载原件查看其他格式", 415);
  const record = await api.json(api.path(name));
  if (token !== undefined && record.token !== token) throw previewError("版本冲突，请先重读当前原件", 409);
  const source = await api.response(api.path(name, "content", { entry }));
  const buffer = await contentBuffer(source);
  const after = await api.json(api.path(name));
  if (record.commit !== after.commit) throw previewError("读取期间版本已变化，请刷新后重试", 409);
  return { name, entry, kind, buffer, record };
}
