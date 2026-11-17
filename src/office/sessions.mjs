import { officeOrigin } from "../config.mjs";
import { capsuleName, entryPath } from "../system/paths.mjs";

export function officeSessionId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value))
    throw Object.assign(new Error("Office会话ID无效"), { status: 400 });
  return value;
}

export function sessionPath(id, operation = "") {
  return `/api/office/sessions/${encodeURIComponent(officeSessionId(id))}${operation ? "/" + operation : ""}`;
}

export async function officeStatus(api) {
  const result = await api.json("/api/office/status");
  checkEditor(api, result);
  return result;
}

function checkEditor(api, result) {
  if (!result.editorUrl) return;
  const expected = officeOrigin(api.config.officeEditorUrl || "http://127.0.0.1:8081");
  if (officeOrigin(result.editorUrl) !== expected)
    throw Object.assign(new Error("客户端与服务端的ONLYOFFICE地址不一致，请核对CAPSULE_ONLYOFFICE_URL后重启客户端"), { status: 409 });
}

export async function openOfficeSession(api, { name, entry, token, mode }) {
  name = capsuleName(name);
  if (entry !== undefined) entry = entryPath(entry);
  if (typeof token !== "string" || !token)
    throw Object.assign(new Error("打开Office编辑需要读取时的版本token"), { status: 400 });
  if (mode !== undefined && !["view", "edit"].includes(mode)) throw Object.assign(new Error("Office模式需为view或edit"), { status: 400 });
  const connection = mode === "view" ? Object.assign(Object.create(api), { leaseProof: undefined }) : api;
  const result = await connection.json("/api/office/sessions", "POST", { name, entry, token, ...(mode ? { mode } : {}) });
  checkEditor(api, result);
  return result;
}

export const getOfficeSession = (api, id) => api.json(sessionPath(id));
export const saveOfficeSession = (api, id) => api.json(sessionPath(id, "save"), "POST", {});
