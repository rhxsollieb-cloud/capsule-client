import { capsuleName } from "../system/paths.mjs";

export const leaseScopes = ["content", "details", "database", "office"];
const invalid = (message) => Object.assign(new Error(message), { status: 400, code: "BAD_REQUEST" });
export function leaseProof(value) {
  if (typeof value !== "string" || !value || value.length > 1024 || /[\s\x00-\x1f\x7f]/.test(value))
    throw invalid("编辑占用凭证无效");
  return value;
}
export function leasedApi(api, proof) {
  if (proof === undefined || proof === "") return api;
  const scoped = Object.create(api);
  scoped.leaseProof = leaseProof(proof);
  return scoped;
}

export async function leaseOperation(api, operation, input) {
  if (!["lease-status", "lease-acquire", "lease-renew", "lease-release"].includes(operation)) throw invalid("未知编辑占用操作");
  const fields = operation === "lease-status" ? ["name"] : operation === "lease-acquire" ? ["name", "id", "scope"] : ["name", "id", "lease"];
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !fields.includes(key)))
    throw invalid("编辑占用参数无效");
  const name = capsuleName(input.name);
  if (operation !== "lease-status" && (typeof input.id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.id)))
    throw invalid("编辑占用id需要客户端生成的UUID");
  if (operation === "lease-acquire" && !leaseScopes.includes(input.scope)) throw invalid("编辑占用scope无效");
  const path = api.path(name, "lease");
  if (operation === "lease-status") return api.json(path);
  if (operation === "lease-acquire") return api.json(path, "POST", { id: input.id, scope: input.scope });
  const headers = input.lease ? { "X-Capsule-Lease": leaseProof(input.lease) } : {};
  if (operation === "lease-renew" && !input.lease) throw invalid("续租需要原编辑占用凭证");
  return leasedApi(api, input.lease).json(path, operation === "lease-renew" ? "PATCH" : "DELETE", { id: input.id }, headers);
}

// Proofs only accompany protected writes; reads and SQL queries never inherit one.
export function protectedLeaseRequest(path, method) {
  const pathname = path.split("?")[0];
  if (/^\/api\/capsules\/[^/]+$/.test(pathname)) return ["PATCH", "DELETE"].includes(method);
  if (/^\/api\/capsules\/[^/]+\/content$/.test(pathname)) return ["PUT", "DELETE"].includes(method);
  if (/^\/api\/capsules\/[^/]+\/(write|skill|revert)$/.test(pathname)) return method === "POST";
  if (/^\/api\/capsules\/[^/]+\/details$/.test(pathname)) return method === "PUT";
  return method === "POST" && (pathname === "/api/office/sessions" || /^\/api\/office\/sessions\/[^/]+\/save$/.test(pathname));
}
