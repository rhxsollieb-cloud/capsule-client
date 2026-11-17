import { ApiClient } from "../api/client.mjs";
import { SkillManager } from "../skills/manager.mjs";
import { uiError } from "./errors.mjs";

export function skillActor(request, input, { api, skills, connectionKey }) {
  const header = request.headers.authorization;
  const isSkill = typeof input.action === "string" && ["skill-register", "skill-status", "skill-start", "skill-stop"].includes(input.action);
  if (!header) {
    if (request.headers["x-capsule-server"] || request.headers["x-capsule-connection"])
      throw Object.assign(uiError("调用方尚未登录，不会借用工作台身份执行 Skill", 401), { code: "LOCAL_LOGIN_REQUIRED" });
    return { api, skills };
  }
  if (!isSkill) throw uiError("调用方凭据仅用于本机 Skill 委派，其他操作请调用统一服务端 API", 403);
  if (request.headers["x-capsule-server"] !== api.config.serverUrl || request.headers["x-capsule-connection"] !== connectionKey)
    throw Object.assign(uiError("本机 Skill 通道的服务器或连接配置已变化，请重新核对", 409), { code: "LOCAL_CLIENT_MISMATCH" });
  const match = /^Bearer (\S{1,1024})$/u.exec(header);
  if (!match) throw uiError("调用方凭据格式无效", 401);
  const actor = new ApiClient({ ...api.config, token: match[1], leaseToken: "", identitySource: "token" }, api.fetcher);
  return { api: actor, skills: new SkillManager(actor, { shared: skills.shared }) };
}
