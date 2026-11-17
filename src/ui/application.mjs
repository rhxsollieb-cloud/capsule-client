import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { ApiClient } from "../api/client.mjs";
import { assertLoopback, checkRequest, checkSession } from "./security.mjs";
import { errorResult, json, requestJson, uiError } from "./errors.mjs";
import { performAction } from "./actions.mjs";
import { staticFile } from "./static.mjs";
import { sendMedia, uploadMedia } from "./media.mjs";
import { officeContentPolicy, sendOfficeRecovery } from "./office.mjs";
import { SkillManager } from "../skills/manager.mjs";
import { sendBackupContent } from "./admin.mjs";

export function createUiApplication({
  config,
  host = "127.0.0.1",
  port = 5183,
  webRoot = fileURLToPath(new URL("../../web/", import.meta.url)),
  maxUploadBytes = 8 * 1024 * 1024 * 1024,
  api = new ApiClient(config),
  skills = new SkillManager(api),
} = {}) {
  assertLoopback(host);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw uiError("界面端口无效");
  if (!config?.serverUrl || !config?.home) throw uiError("客户端配置缺失");
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1)
    throw uiError("上传上限无效");
  const csrfToken = randomBytes(32).toString("hex");
  const contentPolicy = officeContentPolicy(config);
  const server = createServer(async (request, response) => {
    try {
      const base = checkRequest(request, server.address().port);
      const url = new URL(request.url, base);
      if (url.pathname === "/ui/session" && request.method === "GET")
        return json(response, 200, { csrfToken, serverUrl: config.serverUrl, officeEditorUrl: config.officeEditorUrl || "http://127.0.0.1:8081" });
      if (url.pathname === "/ui/action") {
        if (request.method !== "POST") throw uiError("该接口需要POST", 405);
        checkSession(request, csrfToken);
        return json(response, 200, await performAction(api, await requestJson(request), { skills, lease: request.headers["x-capsule-lease"] }));
      }
      if (url.pathname === "/ui/upload") {
        if (request.method !== "PUT") throw uiError("该接口需要PUT", 405);
        checkSession(request, csrfToken);
        return json(response, 200, await uploadMedia(request, url, api, maxUploadBytes));
      }
      if (url.pathname === "/ui/content") {
        if (!["GET", "HEAD"].includes(request.method)) throw uiError("该接口需要GET或HEAD", 405);
        return await sendMedia(request, response, url, api);
      }
      if (url.pathname === "/ui/office/recovery") {
        if (request.method !== "GET") throw uiError("该接口需要GET", 405);
        return await sendOfficeRecovery(response, url, api);
      }
      if (url.pathname === "/ui/admin/backup-content") {
        if (request.method !== "GET") throw uiError("该接口需要GET", 405);
        return await sendBackupContent(response, url, api);
      }
      if (url.pathname.startsWith("/ui/")) throw uiError("接口不存在", 404);
      if (!["GET", "HEAD"].includes(request.method)) throw uiError("静态文件只接受读取", 405);
      await staticFile(request, response, url.pathname, webRoot, contentPolicy);
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy(error);
        return;
      }
      json(response, error.status || 500, errorResult(error, api));
    }
  });
  return {
    server,
    get url() {
      const address = server.address();
      return address && typeof address !== "string"
        ? `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`
        : null;
    },
    async start() {
      server.listen(port, host);
      await once(server, "listening");
      return this;
    },
    async close() {
      try { await skills.close?.(); }
      finally {
        if (server.listening)
          await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    },
  };
}
