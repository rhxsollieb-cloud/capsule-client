import { capsuleName } from "../system/paths.mjs";

const page = ["limit", "offset"];
export const adminFields = Object.freeze({
  me: [], users: page, "user-create": ["name", "role", "enabled"],
  "user-update": ["id", "revision", "name", "role", "enabled"],
  credentials: ["userId", ...page], "credential-create": ["userId", "label"],
  "credential-revoke": ["id", "revision"], grants: ["name"],
  "grant-set": ["name", "revision", "userId", "permission"],
  audit: ["name", "operation", "outcome", ...page],
  backups: page, "backup-create": ["label"], "backup-inspect": ["id"],
  "backup-register": ["id", "checksum"],
  "backup-verify": ["id"], "backup-restore-preview": ["id"],
  "backup-restore": ["id", "previewId", "checksum", "confirmationName"],
  "backup-receipt": ["restoreId"],
});

const invalid = (message) => Object.assign(new Error(message), { status: 400, code: "BAD_REQUEST" });
function identifier(value, label = "ID") {
  if (typeof value !== "string" || !value.trim() || /[\x00-\x1f]/.test(value)) throw invalid(`${label}不能为空或包含控制字符`);
  return encodeURIComponent(value);
}
function query(api, path, input) { return api.json(api.query(path, input)); }
function backupWrite(api, path, input) { return api.json(path, "POST", input, {}, { signal: AbortSignal.timeout(30 * 60 * 1000) }); }
function without(input, ...keys) { return Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key))); }
export const backupContentPath = (id) => `/api/backups/${identifier(id, "备份ID")}/content`;

export async function adminOperation(api, operation, input = {}) {
  if (!Object.hasOwn(adminFields, operation)) throw invalid("未知管理操作");
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !adminFields[operation].includes(key))) throw invalid("管理操作参数无效");
  const value = Object.fromEntries(Object.entries(input).filter(([, item]) => item !== undefined));
  for (const [key, minimum] of [["limit", 1], ["offset", 0], ["revision", 0]])
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < minimum || key === "limit" && value[key] > 100))
      throw invalid(`${key}超出允许范围`);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") throw invalid("enabled需要布尔值");
  if (value.role !== undefined && !["admin", "editor", "viewer"].includes(value.role)) throw invalid("角色需为admin、editor或viewer");
  if (operation === "me") return api.json("/api/access/me");
  if (operation === "users") return query(api, "/api/access/users", value);
  if (operation === "user-create") return api.json("/api/access/users", "POST", value);
  if (operation === "user-update") return api.json(`/api/access/users/${identifier(value.id)}`, "PATCH", without(value, "id"));
  if (operation === "credentials") return query(api, "/api/access/credentials", value);
  if (operation === "credential-create") return api.json("/api/access/credentials", "POST", value);
  if (operation === "credential-revoke") return api.json(`/api/access/credentials/${identifier(value.id)}`, "DELETE", without(value, "id"));
  if (["grants", "grant-set"].includes(operation)) {
    const name = capsuleName(value.name);
    const path = api.path(name, "access");
    if (operation === "grants") return api.json(path);
    if (!["read", "edit", null].includes(value.permission)) throw invalid("permission需为read、edit或null（撤销）");
    return api.json(path, "PUT", without(value, "name"));
  }
  if (operation === "audit") return query(api, "/api/audit", { ...without(value, "operation"), action: value.operation });
  if (operation === "backups") return query(api, "/api/backups", value);
  if (operation === "backup-create") return backupWrite(api, "/api/backups", value);
  if (operation === "backup-receipt") return api.json(`/api/backups/operations/${identifier(value.restoreId, "恢复回执ID")}`);
  const path = `/api/backups/${identifier(value.id, "备份ID")}`;
  if (operation === "backup-inspect") return api.json(path);
  if (operation === "backup-verify") return backupWrite(api, path + "/verify", {});
  if (operation === "backup-register") return backupWrite(api, path + "/register", without(value, "id"));
  if (operation === "backup-restore-preview") return backupWrite(api, path + "/restore-preview", {});
  const result = await backupWrite(api, path + "/restore", without(value, "id"));
  const failure = (message, code, uncertain = false) => Object.assign(new Error(message), {
    code, result, status: code === "RESTORE_PENDING" ? 503 : code === "RESTORE_RECEIPT_INVALID" ? 502 : result?.error?.status || 500,
    ...(result?.restoreId || result?.id ? { operationId: result.restoreId || result.id } : {}), ...(uncertain ? { uncertain: true } : {}),
  });
  if (result?.status === "failed") throw failure(result.error?.message || "原隔离恢复操作失败，请查询原回执", result.error?.code || "RESTORE_FAILED");
  if (result?.status === "running") throw failure("原隔离恢复仍在进行，请查询原操作回执，勿重新预演或重放", "RESTORE_PENDING", true);
  if (result?.status !== "succeeded" || result.isolated !== true || typeof result.restoreId !== "string")
    throw failure("恢复响应未确认已完成隔离恢复，请查询原操作回执", "RESTORE_RECEIPT_INVALID", true);
  return result;
}
