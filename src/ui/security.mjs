import { timingSafeEqual } from "node:crypto";
import { uiError } from "./errors.mjs";

const loopback = new Set(["127.0.0.1", "localhost", "::1"]);

export function assertLoopback(host) {
  if (!loopback.has(host)) throw uiError("图形客户端只允许回环监听");
}

export function checkRequest(request, port) {
  let origin;
  try {
    origin = new URL(`http://${request.headers.host}`);
  } catch {
    throw uiError("请求Host无效", 403);
  }
  const hostname = origin.hostname.replace(/^\[|\]$/g, "");
  if (!loopback.has(hostname) || Number(origin.port || 80) !== port ||
      origin.username || origin.password || origin.pathname !== "/")
    throw uiError("请求Host不属于本地客户端", 403);
  if (request.headers.origin && request.headers.origin !== origin.origin)
    throw uiError("拒绝跨来源操作", 403);
  if (request.headers["sec-fetch-site"] === "cross-site")
    throw uiError("拒绝跨站点读取本地客户端", 403);
  return origin;
}

export function checkSession(request, expected) {
  const actual = Buffer.from(request.headers["x-capsule-session"] || "");
  const token = Buffer.from(expected);
  if (actual.length !== token.length || !timingSafeEqual(actual, token))
    throw uiError("本地会话已失效，请刷新界面", 403);
}
