import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { officeOrigin } from "../config.mjs";
import { sessionPath } from "../office/sessions.mjs";
import { uiError } from "./errors.mjs";

export function officeContentPolicy(config) {
  const origin = officeOrigin(config.officeEditorUrl || "http://127.0.0.1:8081");
  return `default-src 'none'; script-src 'self' ${origin}; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self' ${origin}; frame-src ${origin} http://127.0.0.1:* http://localhost:*; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}

export async function sendOfficeRecovery(response, url, api) {
  const source = await api.response(sessionPath(url.searchParams.get("id"), "recovery"));
  if (!source.body) throw uiError("恢复原件内容为空", 502);
  const disposition = source.headers.get("Content-Disposition");
  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": disposition?.startsWith("attachment;") ? disposition : 'attachment; filename="office-recovery"',
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  const length = source.headers.get("Content-Length");
  if (length) headers["Content-Length"] = length;
  response.writeHead(200, headers);
  await pipeline(Readable.fromWeb(source.body), response);
}
