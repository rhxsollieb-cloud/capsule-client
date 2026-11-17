import { localClientOrigin } from "../config.mjs";
import { ConnectionStore } from "../connection/store.mjs";

export async function localSkillAction(config, action, name) {
  if (typeof config.token !== "string" || !config.token)
    throw Object.assign(new Error("当前 CLI 尚未登录，请先使用 login；不会借用工作台的其他身份执行 Skill"), { status: 401, code: "LOCAL_LOGIN_REQUIRED" });
  const base = new URL(localClientOrigin(config.clientUrl || "http://127.0.0.1:5183"));
  let session;
  try {
    const response = await fetch(new URL("/ui/session", base), { redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    session = await response.json();
  } catch (error) { throw new Error(`本机客户端未就绪，请先启动图形客户端：${error.message}`); }
  const connectionKey = config.connectionKey || new ConnectionStore(config.home ? { CAPSULE_CONFIG_HOME: config.home } : {}).key;
  if (session.serverUrl !== config.serverUrl || session.connectionKey !== connectionKey)
    throw Object.assign(new Error("本机客户端的服务器或配置目录与当前 CLI 不一致；请连接同一个客户端通道，不会借用其身份执行 Skill"), { status: 409, code: "LOCAL_CLIENT_MISMATCH" });
  let response;
  let value;
  try {
    response = await fetch(new URL("/ui/action", base), {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(45000),
      headers: { Origin: base.origin, "Content-Type": "application/json", "X-Capsule-Session": session.csrfToken,
        "X-Capsule-Server": config.serverUrl, "X-Capsule-Connection": connectionKey,
        ...(config.token ? { Authorization: "Bearer " + config.token } : {}),
      },
      body: JSON.stringify({ action, name }),
    });
    value = await response.json();
  } catch (cause) {
    const mutating = action !== "skill-status";
    throw Object.assign(new Error(`本机 Skill 操作响应未确认：${cause.message}${mutating ? "；请先用 skill-status 查询，勿重复提交" : ""}`, { cause }), {
      code: mutating ? "LOCAL_SKILL_RESULT_UNKNOWN" : "LOCAL_SKILL_QUERY_FAILED", ...(mutating ? { uncertain: true } : {}),
    });
  }
  if (!response.ok) throw Object.assign(new Error(value.error || `本机操作失败 ${response.status}`), {
    status: response.status, code: value.code,
    ...(value.eventId ? { eventId: value.eventId } : {}),
    ...(value.uncertain ? { uncertain: true } : {}),
    ...(value.result ? { result: value.result } : {}),
  });
  return value;
}
