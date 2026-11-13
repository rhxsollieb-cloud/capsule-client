import { capsuleName } from "../system/paths.mjs";
import { virtualPath } from "./mounts.mjs";

export const overview = (api) => api.json("/api/overview");
export const whereCapsule = (api, name, page = {}) => api.json(api.path(capsuleName(name), "positions", page));
export const searchCapsules = (api, input = {}) => api.json(api.query("/api/search", { ...input, path: virtualPath(input.path || "/") }));
