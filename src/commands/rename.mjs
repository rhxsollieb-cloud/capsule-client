import { posix } from "node:path";
import { positionMount, virtualPath } from "../operations/mounts.mjs";
import { capsuleName } from "../system/paths.mjs";
import { readJsonInput } from "./input.mjs";
import { parseRenamePlan, preparedRename, sameRenameRange, validRenameRange } from "./rename-plan.mjs";

const invalidResponse = (message, details) => Object.assign(new Error(message), { status: 502, code: "INVALID_RESPONSE", ...details });
const nonempty = (value) => typeof value === "string" && value.length > 0;

async function renameInput(api, [source, target], values) {
  const name = capsuleName(target);
  const input = { name, token: values.token, mountsToken: values["mounts-token"] };
  if (!source.startsWith("/")) return { ...input, sourceName: capsuleName(source) };
  const path = virtualPath(source, { root: false });
  const sourceName = posix.basename(path);
  if (values.into !== undefined) return { ...input, sourceName, path, into: virtualPath(values.into) };
  const position = await positionMount(api, path);
  if (position?.path !== path || !Array.isArray(position.items) || !position.items.some((item) => item?.path === path && item.name === sourceName))
    throw invalidResponse("位置查询返回无效结果，无法核对重命名源");
  return { ...input, sourceName };
}

async function applyRename(api, input, expectedPositions) {
  const { sourceName, name, token, mountsToken, path, into } = input;
  try {
    const result = await api.json(api.path(sourceName, "rename"), "POST", { name, token, mountsToken, path, into });
    if (result?.name !== name || result.previousName !== sourceName || !nonempty(result.commit) || !nonempty(result.token) || !nonempty(result.eventId) ||
        !validRenameRange(result.movedPositions, result.path, input) || (expectedPositions && !sameRenameRange(expectedPositions, result.movedPositions)))
      throw invalidResponse("重命名响应缺少有效的范围、版本或事件ID", { uncertain: true, ...(nonempty(result?.eventId) ? { eventId: result.eventId } : {}) });
    return result;
  } catch (error) {
    if (!error.status || error.uncertain || error.status >= 500) {
      error.unknownResult = true;
      error.message += `；重命名结果未知，请查询 stat ${name}${error.eventId ? ` 及 event ${error.eventId}` : " 与 events"}，不能自动重放`;
    }
    throw error;
  }
}

export async function renameCommand(api, positional, values, context) {
  if (values.plan !== undefined) {
    const { plan, affectedPositions } = parseRenamePlan(await readJsonInput(values.plan, { ...context, maxBytes: 16 * 1024 * 1024 }));
    return applyRename(api, plan, affectedPositions);
  }
  const input = await renameInput(api, positional, values);
  if (!values["dry-run"]) return applyRename(api, input);
  const { sourceName, name, path, into } = input;
  const preview = await api.json(api.path(sourceName, "rename", { name, path, into }));
  const prepared = preparedRename(preview, input);
  if (!prepared) throw invalidResponse("重命名预演缺少有效的名称、范围或版本");
  return prepared;
}
