import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function configuration(env = process.env) {
  const url = new URL(env.CAPSULE_SERVER_URL || "http://127.0.0.1:5184");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("服务端地址需使用 HTTP/HTTPS，凭据请通过 CAPSULE_TOKEN 配置");
  if (url.search || url.hash || !["", "/"].includes(url.pathname))
    throw new Error("CAPSULE_SERVER_URL 需为服务端根地址");
  return {
    serverUrl: url.origin,
    clientUrl: localClientOrigin(env.CAPSULE_CLIENT_URL || `http://127.0.0.1:${env.CAPSULE_UI_PORT || 5183}`),
    officeEditorUrl: officeOrigin(env.CAPSULE_ONLYOFFICE_URL || "http://127.0.0.1:8081"),
    token: env.CAPSULE_TOKEN || "",
    leaseToken: env.CAPSULE_LEASE_TOKEN || "",
    home: resolve(
      env.CAPSULE_CLIENT_HOME ||
        fileURLToPath(new URL("../.local", import.meta.url)),
    ),
  };
}

export function localClientOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("CAPSULE_CLIENT_URL 必须是本机客户端 HTTP 根地址");
  return url.origin;
}

export function officeOrigin(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname))
    throw new Error("ONLYOFFICE地址需要HTTP/HTTPS根地址，不能包含凭据或查询参数");
  return url.origin;
}

export function assertNodeVersion() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("胶囊客户端需要 Node.js 24 或以上");
}
