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
    token: env.CAPSULE_TOKEN || "",
    home: resolve(
      env.CAPSULE_CLIENT_HOME ||
        fileURLToPath(new URL("../.local", import.meta.url)),
    ),
  };
}

export function assertNodeVersion() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("胶囊客户端需要 Node.js 24 或以上");
}
