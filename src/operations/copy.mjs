import { capsuleName } from "../system/paths.mjs";

export async function copyCapsule(api, { name, to, token }) {
  const source = capsuleName(name);
  const target = capsuleName(to);
  if (source === target) throw Object.assign(new Error("副本必须使用新的全库唯一名称"), { status: 400 });
  if (typeof token !== "string" || !token)
    throw Object.assign(new Error("复制需要源 cap 读取时的 token"), { status: 400 });
  try {
    return await api.json(api.path(source, "copy"), "POST", { name: target, token });
  } catch (error) {
    if (error.uncertain || error.eventId || error.code === "PUBLISH_PENDING")
      error.message += `；请先查询目标 ${target}${error.eventId ? ` 和原事件 ${error.eventId}` : ""}，不要重新提交复制`;
    throw error;
  }
}
