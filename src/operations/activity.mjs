import { capsuleName, entryPath } from "../system/paths.mjs";

const scopes = ["content", "details", "database", "office"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400, code: "BAD_REQUEST" });
}

function parameters(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !fields.includes(key)))
    throw invalid("占用操作参数无效");
  let name;
  try { name = capsuleName(input.name); }
  catch (error) { throw invalid(error.message); }
  return { name };
}

function uuid(value, field) {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw invalid(`${field}需要有效UUID`);
  return value.toLowerCase();
}

export function readActivity(api, input) {
  const { name } = parameters(input, ["name", "clientId"]);
  const clientId = input.clientId === undefined ? undefined : uuid(input.clientId, "clientId");
  return api.json(api.path(name, "activity", { clientId }));
}

export function heartbeatActivity(api, input) {
  const { name } = parameters(input, ["name", "clientId", "sessionId", "scope", "entry", "dirty"]);
  const value = {
    clientId: uuid(input.clientId, "clientId"),
    sessionId: uuid(input.sessionId, "sessionId"),
    scope: input.scope,
    dirty: input.dirty,
  };
  if (!scopes.includes(value.scope)) throw invalid("占用范围需为content、details、database或office");
  if (typeof value.dirty !== "boolean") throw invalid("dirty需要布尔值");
  if (input.entry !== undefined) {
    try { value.entry = entryPath(input.entry); }
    catch (error) { throw invalid(error.message); }
  }
  return api.json(api.path(name, "activity"), "POST", value);
}

export function releaseActivity(api, input) {
  const { name } = parameters(input, ["name", "clientId", "sessionId"]);
  const value = { clientId: uuid(input.clientId, "clientId"), sessionId: uuid(input.sessionId, "sessionId") };
  return api.json(api.path(name, "activity"), "DELETE", value);
}
