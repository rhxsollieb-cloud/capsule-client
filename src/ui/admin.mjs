import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { backupContentPath } from "../operations/admin.mjs";
import { uiError } from "./errors.mjs";

export async function sendBackupContent(response, url, api) {
  const id = url.searchParams.get("id");
  const source = await api.response(backupContentPath(id), { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!source.body) throw uiError("备份归档内容为空", 502);
  const filename = encodeURIComponent(`capsule-backup-${id}.tar`).replace(/[!'()*]/g, (value) => "%" + value.charCodeAt(0).toString(16).toUpperCase());
  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="capsule-backup.tar"; filename*=UTF-8''${filename}`,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  const size = source.headers.get("Content-Length");
  if (size) headers["Content-Length"] = size;
  response.writeHead(200, headers);
  await pipeline(Readable.fromWeb(source.body), response);
}
