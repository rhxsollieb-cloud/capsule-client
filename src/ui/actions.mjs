import { capsuleName, entryPath } from "../system/paths.mjs";
import { runCapsule } from "../runtime/run.mjs";
import { synchronize } from "../cache/sync.mjs";
import { uiError } from "./errors.mjs";
import { previewOffice } from "../preview/office.mjs";

const allowed = {
  health: [],
  list: ["kind", "query", "limit", "offset"],
  ls: ["path", "limit", "offset"],
  stat: ["name", "commit"],
  entries: ["name", "limit", "offset"],
  read: ["name", "entry", "from", "limit"],
  preview: ["name", "entry"],
  history: ["name", "limit", "offset"],
  events: ["status", "limit", "offset"],
  event: ["id"],
  create: ["name", "kind", "description", "body", "runtime"],
  save: ["name", "entry", "body", "token"],
  update: ["name", "description", "runtime", "token"],
  query: ["name", "sql", "parameters", "text", "entry", "limit", "offset"],
  write: ["name", "statements", "token"],
  mount: ["name", "path"],
  revert: ["name", "commit", "token"],
  run: ["name", "args", "logCap"],
  sync: ["name"],
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

export async function performAction(api, input) {
  if (typeof input.action !== "string" || !Object.hasOwn(allowed, input.action))
    throw uiError("未知客户端操作");
  const fields = allowed[input.action];
  if (Object.keys(input).some((key) => key !== "action" && !fields.includes(key)))
    throw uiError("操作参数无效");
  const value = select(input, fields);
  if (fields.includes("name")) value.name = validatedPath(value.name, capsuleName);
  if (value.entry !== undefined) value.entry = validatedPath(value.entry, entryPath);
  if (fields.includes("token") && (typeof value.token !== "string" || !value.token))
    throw uiError("请先读取当前版本再提交修改");
  const { action } = input;
  if (action === "health") return api.json("/api/health");
  if (action === "list") return api.json(api.query("/api/capsules", value));
  if (action === "ls") return api.json(api.query("/api/mounts", value));
  if (action === "events") return api.json(api.query("/api/events", value));
  if (action === "event") {
    if (typeof value.id !== "string" || !value.id) throw uiError("事件ID不能为空");
    return api.json(`/api/events/${encodeURIComponent(value.id)}`);
  }
  if (action === "create") return api.json("/api/capsules", "POST", value);
  if (action === "mount") return api.json("/api/mounts", "POST", value);
  if (action === "preview") return previewOffice(api, value.name, value.entry);
  const name = value.name;
  delete value.name;
  if (action === "stat") return api.json(api.path(name, "", value));
  if (["entries", "read", "history"].includes(action))
    return api.json(api.path(name, action, value));
  if (action === "update") return api.json(api.path(name), "PATCH", value);
  if (action === "save") return api.json(api.path(name, "write"), "POST", value);
  if (["write", "query", "revert"].includes(action))
    return api.json(api.path(name, action), "POST", value);
  if (action === "sync") return synchronize(api, name);
  if (!Array.isArray(value.args ?? []) || (value.args ?? []).some((arg) => typeof arg !== "string"))
    throw uiError("工具参数需要字符串数组");
  return runCapsule(api, name, value.args || [], { logCap: value.logCap });
}
