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
import { Authentication } from "../operations/auth.mjs";
import { authRoute } from "./auth.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { skillActor } from "./skill-delegation.mjs";

export function createUiApplication({
  config,
  host = "127.0.0.1",
  port = 5183,
  webRoot = fileURLToPath(new URL("../../web/", import.meta.url)),
  maxUploadBytes = 8 * 1024 * 1024 * 1024,
  api = new ApiClient(config),
  skills = new SkillManager(api),
  authentication = new Authentication({ env: { CAPSULE_CONFIG_HOME: config?.connectionHome || config?.home }, config, fetcher: api.fetcher }),
} = {}) {
  assertLoopback(host);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw uiError("界面端口无效");
  if (!config?.serverUrl || !config?.home) throw uiError("客户端配置缺失");
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1)
    throw uiError("上传上限无效");
  let csrfToken = randomBytes(32).toString("hex");
  let contentPolicy = officeContentPolicy(config);
  let changingIdentity = false;
  let activeRequests = 0;
  const beforeChange = async () => {
    const deadline = Date.now() + 2000;
    while (activeRequests && Date.now() < deadline) await delay(20);
    if (activeRequests) throw uiError("当前还有正在处理的操作，请等待完成后再切换身份", 409);
    await skills.close();
  };
  const changed = () => {
    config = authentication.config;
    api = authentication.api();
    skills = new SkillManager(api);
    contentPolicy = officeContentPolicy(config);
    csrfToken = randomBytes(32).toString("hex");
  };
  const server = createServer(async (request, response) => {
    let counted = false;
    const requestApi = api;
    try {
      const base = checkRequest(request, server.address().port);
      const url = new URL(request.url, base);
      if (url.pathname === "/ui/session" && request.method === "GET")
        return json(response, 200, { csrfToken, connectionKey: authentication.store.key, serverUrl: config.serverUrl, officeEditorUrl: config.officeEditorUrl || "http://127.0.0.1:8081" });
      if (url.pathname.startsWith("/ui/auth/")) {
        if (changingIdentity) throw uiError("本机正在切换连接或身份，请稍后重试", 409);
        if (request.method === "POST") checkSession(request, csrfToken);
        changingIdentity = request.method === "POST";
        try { return await authRoute(request, response, url, { authentication, beforeChange, changed }); }
        catch (error) {
          if (error.identityChanged) changed();
          else if (skills.closed) skills = new SkillManager(api);
          throw error;
        }
        finally { changingIdentity = false; }
      }
      if (changingIdentity && url.pathname.startsWith("/ui/")) throw uiError("本机正在切换连接或身份，请稍后重试", 409);
      if (["/ui/content", "/ui/office/recovery", "/ui/admin/backup-content"].includes(url.pathname)) {
        checkSession({ headers: { "x-capsule-session": request.headers["x-capsule-session"] || url.searchParams.get("session") } }, csrfToken);
        url.searchParams.delete("session");
      }
      if (url.pathname.startsWith("/ui/")) { activeRequests++; counted = true; }
      if (url.pathname === "/ui/action") {
        if (request.method !== "POST") throw uiError("该接口需要POST", 405);
        checkSession(request, csrfToken);
        const input = await requestJson(request);
        const actor = skillActor(request, input, { api, skills, connectionKey: authentication.store.key });
        return json(response, 200, await performAction(actor.api, input, { skills: actor.skills, lease: request.headers["x-capsule-lease"] }));
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
      json(response, error.status || 500, errorResult(error, requestApi));
    } finally {
      if (counted) activeRequests--;
    }
  });
  return {
    server,
    authentication,
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
