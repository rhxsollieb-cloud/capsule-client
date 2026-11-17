import { resolve } from "node:path";
import { defaultClientHome } from "./system/clientHome.mjs";

export function configuration(env = process.env, { profile, human = false } = {}) {
  const url = new URL((human ? profile?.serverUrl || env.CAPSULE_SERVER_URL : env.CAPSULE_SERVER_URL || profile?.serverUrl) || "http://127.0.0.1:5184");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("服务端地址需使用 HTTP/HTTPS，凭据请通过 CAPSULE_TOKEN 配置");
  if (url.search || url.hash || !["", "/"].includes(url.pathname))
    throw new Error("CAPSULE_SERVER_URL 需为服务端根地址");
  const session = profile?.serverUrl === url.origin ? profile.session : undefined;
  const environmentToken = human ? "" : env.CAPSULE_TOKEN || "";
  return {
    serverUrl: url.origin,
    clientUrl: localClientOrigin(env.CAPSULE_CLIENT_URL || (env.CAPSULE_UI_PORT ? `http://127.0.0.1:${env.CAPSULE_UI_PORT}` : profile?.clientUrl) || "http://127.0.0.1:5183"),
    officeEditorUrl: officeOrigin((human ? profile?.officeEditorUrl || env.CAPSULE_ONLYOFFICE_URL : env.CAPSULE_ONLYOFFICE_URL || profile?.officeEditorUrl) || "http://127.0.0.1:8081"),
    token: environmentToken || session?.token || "",
    identitySource: environmentToken ? "token" : session?.token ? "session" : "none",
    ...(session?.expiresAt ? { sessionExpiresAt: session.expiresAt } : {}),
    leaseToken: env.CAPSULE_LEASE_TOKEN || "",
    home: resolve(
      env.CAPSULE_CLIENT_HOME || defaultClientHome(env),
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
