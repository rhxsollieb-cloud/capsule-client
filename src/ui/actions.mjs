import { capsuleName, entryPath } from "../system/paths.mjs";
import { runCapsule } from "../runtime/run.mjs";
import { synchronize } from "../cache/sync.mjs";
import { uiError } from "./errors.mjs";
import { readTable, writeTable } from "../database/tables.mjs";
import { writeOffice } from "../office/write.mjs";
import { previewOffice } from "../preview/office.mjs";
import { getOfficeSession, officeStatus, openOfficeSession, saveOfficeSession } from "../office/sessions.mjs";
import { listMounts, mountCapsule, moveMount, positionMount, unmountMount } from "../operations/mounts.mjs";
import { overview, searchCapsules, whereCapsule } from "../operations/discovery.mjs";
import { inspectOrganization, organizationReceipt, organizeMounts } from "../operations/organization.mjs";
import { editText } from "../operations/content.mjs";
import { heartbeatActivity, readActivity, releaseActivity } from "../operations/activity.mjs";
import { adminFields, adminOperation } from "../operations/admin.mjs";
import { leasedApi, leaseOperation } from "../operations/leases.mjs";
import { copyCapsule } from "../operations/copy.mjs";

const protectedActions = new Set(["save-details", "office-open", "office-save", "office-write", "table-write", "save", "edit", "update", "write", "delete", "revert", "convert-skill"]);

const allowed = {
  health: [],
  overview: [],
  activity: ["name", "clientId"],
  "activity-heartbeat": ["name", "clientId", "sessionId", "scope", "entry", "dirty"],
  "activity-release": ["name", "clientId", "sessionId"],
  list: ["kind", "query", "limit", "offset"],
  ls: ["path", "limit", "offset"],
  where: ["name", "limit", "offset"],
  search: ["path", "kind", "query", "text", "limit", "offset"],
  "organize-inspect": ["limit", "offset"],
  organize: ["plan", "dryRun", "limit", "offset"],
  "organize-receipt": ["receipt", "limit", "offset"],
  stat: ["name", "commit"],
  entries: ["name", "directory", "limit", "offset"],
  read: ["name", "entry", "from", "around", "anchor", "limit"],
  details: ["name", "from", "around", "anchor", "limit"],
  "save-details": ["name", "body", "description", "token"],
  preview: ["name", "entry"],
  "office-status": [],
  "office-open": ["name", "entry", "token", "mode"],
  "office-session": ["id"],
  "office-save": ["id"],
  "office-write": ["name", "entry", "changes", "token"],
  table: ["name", "table", "limit", "offset"],
  "table-write": ["name", "table", "changes", "token"],
  history: ["name", "limit", "offset"],
  events: ["status", "limit", "offset"],
  event: ["id"],
  create: ["name", "kind", "description", "body", "runtime"],
  copy: ["name", "to", "token"],
  save: ["name", "entry", "body", "token"],
  edit: ["name", "entry", "oldText", "newText", "all", "token"],
  update: ["name", "description", "runtime", "token"],
  query: ["name", "sql", "parameters", "text", "entry", "limit", "offset"],
  write: ["name", "statements", "token"],
  mount: ["name", "path"],
  position: ["path"],
  move: ["path", "to", "token"],
  unmount: ["path", "token"],
  removal: ["name"],
  delete: ["name", "token", "mountsToken"],
  revert: ["name", "commit", "token"],
  run: ["name", "args", "logCap"],
  sync: ["name"],
  "skill-register": ["name"],
  "skill-status": ["name"],
  "skill-start": ["name"],
  "skill-stop": ["name"],
  "convert-skill": ["name", "token"],
};

function select(input, fields) {
  return Object.fromEntries(fields.filter((key) => input[key] !== undefined)
    .map((key) => [key, input[key]]));
}

function validatedPath(value, validator) {
  try {
    return validator(value);
  } catch (error) {
    throw uiError(error.message);
  }
}

export async function performAction(api, input, { skills, lease, signal } = {}) {
  if (typeof input.action === "string" && ["lease-status", "lease-acquire", "lease-renew", "lease-release"].includes(input.action))
    return leaseOperation(api, input.action, { ...Object.fromEntries(Object.entries(input).filter(([key]) => key !== "action")), ...(["lease-renew", "lease-release"].includes(input.action) && lease ? { lease } : {}) });
  if (protectedActions.has(input.action) && !(input.action === "office-open" && input.mode === "view")) api = leasedApi(api, lease);
  if (typeof input.action === "string" && Object.hasOwn(adminFields, input.action))
    return adminOperation(api, input.action, Object.fromEntries(Object.entries(input).filter(([key]) => key !== "action")));
  if (typeof input.action !== "string" || !Object.hasOwn(allowed, input.action))
    throw uiError("未知客户端操作");
  const fields = allowed[input.action];
  if (Object.keys(input).some((key) => key !== "action" && !fields.includes(key)))
    throw uiError("操作参数无效");
  const value = select(input, fields);
  if (fields.includes("name")) value.name = validatedPath(value.name, capsuleName);
  if (value.entry !== undefined) value.entry = validatedPath(value.entry, entryPath);
  if (value.directory !== undefined && value.directory !== "") value.directory = validatedPath(value.directory, entryPath);
  if (fields.includes("token") && (typeof value.token !== "string" || !value.token))
    throw uiError("请先读取当前版本再提交修改");
  if (fields.includes("mountsToken") && (typeof value.mountsToken !== "string" || !value.mountsToken))
    throw uiError("请先读取清除预览取得挂载版本");
  const { action } = input;
  if (action.startsWith("skill-")) {
    const method = action.slice("skill-".length);
    if (!skills || typeof skills[method] !== "function") throw uiError("本机skill管理服务尚未启动，请先启动客户端界面服务", 503);
    await api.json("/api/access/me");
    await api.json(api.path(value.name));
    return skills[method](value.name);
  }
  if (action === "health") return api.json("/api/health");
  if (action === "overview") return overview(api);
  if (action === "activity") return readActivity(api, value);
  if (action === "activity-heartbeat") return heartbeatActivity(api, value);
  if (action === "activity-release") return releaseActivity(api, value);
  if (action === "where") return whereCapsule(api, value.name, select(value, ["limit", "offset"]));
  if (action === "search") return searchCapsules(api, value);
  if (action === "organize-inspect") return inspectOrganization(api, value);
  if (action === "organize") return organizeMounts(api, value);
  if (action === "organize-receipt") return organizationReceipt(api, value.receipt, select(value, ["limit", "offset"]));
  if (action === "office-status") return officeStatus(api);
  if (action === "office-open") return openOfficeSession(api, value);
  if (action === "office-session") return getOfficeSession(api, value.id);
  if (action === "office-save") return saveOfficeSession(api, value.id);
  if (action === "list") return api.json(api.query("/api/capsules", value));
  if (action === "ls") return listMounts(api, value);
  if (action === "events") return api.json(api.query("/api/events", value));
  if (action === "event") {
    if (typeof value.id !== "string" || !value.id) throw uiError("事件ID不能为空");
    return api.json(`/api/events/${encodeURIComponent(value.id)}`);
  }
  if (action === "create") return api.json("/api/capsules", "POST", value);
  if (action === "copy") return copyCapsule(api, value);
  if (action === "mount") return mountCapsule(api, value);
  if (action === "position") return positionMount(api, value.path);
  if (action === "move") return moveMount(api, value);
  if (action === "unmount") return unmountMount(api, value);
  if (action === "edit") return editText(api, value);
  if (action === "removal") return api.json(api.path(value.name, "removal"));
  if (action === "delete") return api.json(api.path(value.name), "DELETE", { token: value.token, mountsToken: value.mountsToken });
  if (action === "convert-skill") return api.json(api.path(value.name, "skill"), "POST", { token: value.token });
  if (action === "preview") return previewOffice(api, value.name, value.entry);
  if (action === "office-write") return writeOffice(api, value.name, value);
  if (action === "table") return readTable(api, value.name, value);
  if (action === "table-write") return writeTable(api, value.name, value);
  const name = value.name;
  delete value.name;
  if (action === "stat") return api.json(api.path(name, "", value));
  if (["entries", "read", "history", "details"].includes(action))
    return api.json(api.path(name, action, value), "GET", undefined, {}, { signal });
  if (action === "save-details") return api.json(api.path(name, "details"), "PUT", value);
  if (action === "update") return api.json(api.path(name), "PATCH", value);
  if (action === "save") return api.json(api.path(name, "write"), "POST", value);
  if (["write", "query", "revert"].includes(action))
    return api.json(api.path(name, action), "POST", value);
  if (action === "sync") return synchronize(api, name);
  if (action !== "run") throw uiError("客户端操作未绑定处理器");
  if (!Array.isArray(value.args ?? []) || (value.args ?? []).some((arg) => typeof arg !== "string"))
    throw uiError("工具参数需要字符串数组");
  return runCapsule(api, name, value.args || [], { logCap: value.logCap });
}
