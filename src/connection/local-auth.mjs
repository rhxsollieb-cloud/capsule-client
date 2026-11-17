import { localClientOrigin } from "../config.mjs";

// Only an unavailable or different local client before POST permits standalone use.
export async function localAuthentication(auth, operation, input) {
  const base = localClientOrigin(auth.config.clientUrl || "http://127.0.0.1:5183");
  let session;
  try {
    const response = await fetch(base + "/ui/session", { redirect: "manual", signal: AbortSignal.timeout(1500) });
    if (!response.ok) return undefined;
    session = await response.json();
    if (session.connectionKey !== auth.store.key || typeof session.csrfToken !== "string") return undefined;
  } catch { return undefined; }
  let response, result;
  try {
    response = await fetch(base + "/ui/auth/" + operation, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(45000),
      headers: { Origin: base, "Content-Type": "application/json", "X-Capsule-Session": session.csrfToken },
      body: JSON.stringify(input),
    });
    result = await response.json();
  } catch (cause) {
    throw Object.assign(new Error("本机身份操作响应未确认，请查询 connection / me 核对，不自动重放", { cause }), { code: "AUTH_RESULT_UNKNOWN", uncertain: true });
  }
  if (!response.ok) throw Object.assign(new Error(result.error || "本机身份操作失败"), { status: response.status, code: result.code,
    ...(result.result ? { result: result.result } : {}), ...(result.uncertain ? { uncertain: true } : {}) });
  return result;
}
