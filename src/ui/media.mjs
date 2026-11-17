import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { capsuleName, entryPath } from "../system/paths.mjs";
import { uiError } from "./errors.mjs";
import { leasedApi } from "../operations/leases.mjs";
import { revalidatedContent } from "../cache/content.mjs";

const previewTypes = new Map([
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"],
  [".gif", "image/gif"], [".webp", "image/webp"], [".avif", "image/avif"],
  [".mp4", "video/mp4"], [".webm", "video/webm"], [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"], [".wav", "audio/wav"], [".ogg", "audio/ogg"],
  [".m4a", "audio/mp4"], [".txt", "text/plain; charset=utf-8"],
]);

function target(url) {
  try {
    const name = capsuleName(url.searchParams.get("name"));
    const raw = url.searchParams.get("entry");
    return { name, entry: raw === null ? undefined : entryPath(raw) };
  } catch (error) {
    throw uiError(error.message);
  }
}

export async function sendMedia(request, response, url, api) {
  const { name, entry } = target(url);
  const conditionals = Object.fromEntries(["range", "if-range", "if-match", "if-none-match"]
    .filter((header) => request.headers[header] !== undefined).map((header) => [header, request.headers[header]]));
  // A small Range must never trigger a full-file prefetch. Browser validators
  // also go directly to the authority, so large cached files can return zero bytes.
  const source = request.method === "HEAD" || Object.keys(conditionals).length
    ? await api.response(api.path(name, "content", { entry }), {
      method: request.method, headers: conditionals, signal: AbortSignal.timeout(30 * 60 * 1000),
    }, { allowNotModified: Boolean(request.headers["if-none-match"]) })
    : (await revalidatedContent(api, name, entry, { allowStreaming: true })).response;
  if (!source.body && source.status !== 304 && request.method !== "HEAD") throw uiError("原件内容为空", 502);
  const filename = basename(entry || name);
  const type = previewTypes.get(extname(filename).toLowerCase());
  const download = url.searchParams.get("download") === "1" || !type;
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (char) =>
    "%" + char.charCodeAt(0).toString(16).toUpperCase());
  const headers = {
    "Content-Type": type || "application/octet-stream",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="download"; filename*=UTF-8''${encoded}`,
    "Cache-Control": source.headers.has("ETag") ? "private, no-cache" : "no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  for (const header of ["content-length", "content-range", "accept-ranges", "etag", "x-capsule-commit", "x-capsule-token"]) {
    const value = source.headers.get(header);
    if (value !== null) headers[header] = value;
  }
  if (source.status === 304) { delete headers["content-length"]; delete headers["content-range"]; }
  response.writeHead(source.status, headers);
  if (source.status === 304 || request.method === "HEAD") { await source.body?.cancel(); response.end(); }
  else await pipeline(Readable.fromWeb(source.body), response);
}

export async function uploadMedia(request, url, api, maximum) {
  api = leasedApi(api, request.headers["x-capsule-lease"]);
  const { name, entry } = target(url);
  const token = request.headers["if-match"];
  if (typeof token !== "string" || !token) throw uiError("上传需要当前版本");
  const length = request.headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    request.resume();
    throw uiError("上传文件超过上限", 413);
  }
  const uploads = join(api.config.home, "uploads");
  await mkdir(uploads, { recursive: true });
  const temporary = await mkdtemp(join(uploads, "ui-"));
  const file = join(temporary, "content");
  let size = 0;
  let handle;
  try {
    handle = await open(file, "wx");
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > maximum) throw uiError("上传文件超过上限", 413);
      await handle.writeFile(chunk);
    }
    await handle.close();
    handle = undefined;
    return await api.upload(name, entry, file, token);
  } catch (error) {
    request.resume();
    throw error;
  } finally {
    if (handle) await handle.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
