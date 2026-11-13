import { capsuleName, entryPath } from "../system/paths.mjs";
const invalid = (message) => Object.assign(new Error(message), { status: 400, code: "BAD_REQUEST" });

export async function editText(api, input) {
  const name = capsuleName(input.name);
  const entry = input.entry === undefined ? undefined : entryPath(input.entry);
  if (typeof input.token !== "string" || !input.token) throw invalid("文字替换需要读取时的token");
  if (typeof input.oldText !== "string" || !input.oldText || typeof input.newText !== "string")
    throw invalid("需要非空oldText与文本newText");
  if (input.all !== undefined && typeof input.all !== "boolean") throw invalid("all需要布尔值");
  const parts = [];
  let from = 1;
  let bytes = 0;
  while (true) {
    const record = await api.json(api.path(name, entry === undefined ? "details" : "read", { ...(entry === undefined ? {} : { entry }), from, limit: 10000 }));
    if (record.token !== input.token) throw Object.assign(new Error("文字替换版本冲突，请重新读取核对，不自动换token"), { status: 409, code: "VERSION_CONFLICT" });
    if (typeof record.body !== "string" || !record.lines) throw Object.assign(new Error("正文读取缺少有效范围"), { status: 502, code: "INVALID_RESPONSE" });
    bytes += Buffer.byteLength(record.body) + (parts.length ? 1 : 0);
    if (bytes > 1024 * 1024) throw invalid("文字替换正文超过1MiB，请使用原件接口");
    parts.push(record.body);
    const next = record.lines.nextLine;
    if (next === null || next === undefined) break;
    if (!Number.isSafeInteger(next) || next <= from) throw Object.assign(new Error("正文续读位置无效"), { status: 502, code: "INVALID_RESPONSE" });
    from = next;
  }
  const body = parts.join("\n");
  const pieces = body.split(input.oldText);
  const replacements = pieces.length - 1;
  if (!replacements) throw invalid("原文没有匹配，未写入");
  if (replacements > 1 && !input.all) throw invalid("原文匹配多处，请使用--all明确替换全部");
  const changed = pieces.join(input.newText);
  if (Buffer.byteLength(changed) > 1024 * 1024) throw invalid("替换结果超过1MiB，未写入");
  try {
    const result = entry === undefined
      ? await api.json(api.path(name, "details"), "PUT", { token: input.token, body: changed })
      : await api.putText(name, entry, changed, input.token);
    return { ...result, replacements };
  } catch (error) {
    if (!error.status) { error.unknownResult = true; error.message += "；替换结果未知，请核对stat/history，不能自动重放"; }
    throw error;
  }
}
