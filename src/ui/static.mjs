import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { uiError } from "./errors.mjs";

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);

export async function staticFile(request, response, pathname, webRoot) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw uiError("静态路径编码无效");
  }
  const relative = decoded === "/" ? "index.html" : decoded.slice(1);
  const parts = relative.split("/");
  if (!decoded.startsWith("/") || relative.includes("\\") ||
      parts.some((part) => !part || part === "." || part === ".." || part.includes("\0")))
    throw uiError("静态路径无效", 403);
  let file = resolve(webRoot);
  try {
    if ((await lstat(file)).isSymbolicLink()) throw uiError("静态目录不能是链接", 403);
    for (const part of parts) {
      file = join(file, part);
      if ((await lstat(file)).isSymbolicLink()) throw uiError("静态文件不能经过链接", 403);
    }
    const info = await lstat(file);
    if (!info.isFile() || !types.has(extname(file))) throw uiError("静态文件不存在", 404);
    response.writeHead(200, {
      "Content-Type": types.get(extname(file)),
      "Content-Length": info.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    });
    if (request.method === "HEAD") response.end();
    else await pipeline(createReadStream(file), response);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR")
      throw uiError("静态文件不存在", 404);
    throw error;
  }
}
