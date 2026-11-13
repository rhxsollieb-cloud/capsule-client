import { capsuleName } from "../system/paths.mjs";

export function virtualPath(value, { root = true } = {}) {
  if (typeof value !== "string" || !value.startsWith("/") || (!root && value === "/"))
    throw Object.assign(new Error("请选择有效的虚拟路径"), { status: 400, code: "BAD_REQUEST" });
  if (value === "/") return value;
  try { return "/" + value.slice(1).split("/").map(capsuleName).join("/"); }
  catch (error) { throw Object.assign(error, { status: 400, code: "BAD_REQUEST" }); }
}

function token(value) {
  if (typeof value !== "string" || !value) throw Object.assign(new Error("位置写入需要当前子树token"), { status: 400, code: "TOKEN_REQUIRED" });
  return value;
}

async function mutation(operation, label) {
  try { return await operation(); }
  catch (error) {
    if (!error.status) {
      error.unknownResult = true;
      error.message += `；${label}结果未知，请查询实际位置，不能自动重放`;
    }
    throw error;
  }
}

export const listMounts = (api, input = {}) => api.json(api.query("/api/mounts", { ...input, path: virtualPath(input.path || "/") }));
export const positionMount = (api, path) => api.json(api.query("/api/mounts/position", { path: virtualPath(path, { root: false }) }));
export function mountCapsule(api, input) {
  const value = { name: capsuleName(input.name), path: virtualPath(input.path, { root: false }) };
  return mutation(() => api.json("/api/mounts", "POST", value), "挂载");
}
export function moveMount(api, input) {
  const value = { path: virtualPath(input.path, { root: false }), to: virtualPath(input.to, { root: false }), token: token(input.token) };
  return mutation(() => api.json("/api/mounts/move", "POST", value), "移动");
}
export function unmountMount(api, input) {
  const path = virtualPath(input.path, { root: false });
  const expected = token(input.token);
  return mutation(() => api.json(api.query("/api/mounts", { path }), "DELETE", undefined, { "If-Match": expected }), "卸载");
}
