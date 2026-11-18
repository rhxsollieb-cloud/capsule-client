import { posix } from "node:path";
import { positionMount, virtualPath } from "../operations/mounts.mjs";
import { capsuleName } from "../system/paths.mjs";
import { waitForEvent } from "./events.mjs";

const invalidResponse = (message, details) => Object.assign(new Error(message), { status: 502, code: "INVALID_RESPONSE", ...details });
const nonempty = (value) => typeof value === "string" && value.length > 0;

async function renameSource(api, source) {
  if (!source.startsWith("/")) return capsuleName(source);
  const path = virtualPath(source, { root: false });
  const name = posix.basename(path);
  const position = await positionMount(api, path);
  if (position?.path !== path || !Array.isArray(position.items) || !position.items.some((item) => item?.path === path && item.name === name))
    throw invalidResponse("位置查询返回无效结果，无法核对重命名源");
  return name;
}

async function renameCommand(api, [source, target], values) {
  const targetName = capsuleName(target);
  const name = await renameSource(api, source);
  if (values["dry-run"]) {
    const preview = await api.json(api.path(name, "rename", { name: targetName }));
    if (preview?.name !== name || preview.targetName !== targetName || !nonempty(preview.token) || !nonempty(preview.mountsToken) ||
        !Array.isArray(preview.affectedPositions) || !Array.isArray(preview.blockedReasons))
      throw invalidResponse("重命名预演缺少有效的名称、范围或版本");
    return { ...preview, dryRun: true, canApply: preview.blockedReasons.length === 0 };
  }
  try {
    const result = await api.json(api.path(name, "rename"), "POST", { name: targetName, token: values.token, mountsToken: values["mounts-token"] });
    if (result?.name !== targetName || result.previousName !== name || !nonempty(result.commit) || !nonempty(result.token) || !nonempty(result.eventId))
      throw invalidResponse("重命名响应缺少有效的名称、版本或事件ID", { uncertain: true, ...(nonempty(result?.eventId) ? { eventId: result.eventId } : {}) });
    return result;
  } catch (error) {
    if (!error.status || error.uncertain || error.status >= 500) {
      error.unknownResult = true;
      error.message += `；重命名结果未知，请查询 stat ${targetName}${error.eventId ? ` 及 event ${error.eventId}` : " 与 events"}，不能自动重放`;
    }
    throw error;
  }
}

export async function managementCommand(api, { command, positional, values }) {
  if (command === "rename") return renameCommand(api, positional, values);
  const name = capsuleName(positional[0]);
  if (command === "removal") return api.json(api.path(name, "removal"));
  let event;
  try {
    event = await api.json(api.path(name), "DELETE", { token: values.token, mountsToken: values["mounts-token"] });
  } catch (error) {
    if (!error.status)
      error.message += "；清除提交结果未知，请查询events核对，不能自动重放";
    throw error;
  }
  return waitForEvent(api, event, {
    timeoutMs: (values.timeout ?? 1800) * 1000,
    operation: "清除",
    validateResult: (result) => result?.name === name && result.removed === true,
  });
}
