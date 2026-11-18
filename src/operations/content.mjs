import { capsuleName, entryPath } from "../system/paths.mjs";
import { checkedReadPage } from "../../web/read-record.mjs";

const TEXT_BYTES = 1024 * 1024;
const invalid = (message) => Object.assign(new Error(message), { status: 400, code: "BAD_REQUEST" });
const invalidResponse = () => Object.assign(new Error("正文分页响应缺少一致的提交号，未作为全文载入"), { status: 502, code: "INVALID_RESPONSE" });
const tooLarge = (message) => Object.assign(new Error(message), { status: 413, code: "TEXT_TOO_LARGE" });

async function readForEdit(api, name, entry, token) {
  const operation = entry === undefined ? "details" : "read";
  const parts = [];
  let first, bytes = 0, from = 1;
  do {
    const record = checkedReadPage(await api.json(api.path(name, operation, { entry, from, limit: 10000 })), {
      from, token: first?.token ?? token, total: first?.lines.total,
    });
    if (typeof record.commit !== "string" || !record.commit || (first && first.commit !== record.commit)) throw invalidResponse();
    first ??= record;
    bytes += Buffer.byteLength(record.body) + (parts.length ? 1 : 0);
    if (bytes > TEXT_BYTES) throw tooLarge("文字替换正文超过1MiB，请使用原件接口");
    parts.push(record.body);
    from = record.lines.nextLine;
  } while (from !== null);
  return { first, body: parts.join("\n"), bytes };
}

function matchCount(body, oldText) {
  let count = 0;
  for (let at = body.indexOf(oldText); at !== -1; at = body.indexOf(oldText, at + oldText.length)) count++;
  return count;
}

function replacementPayload(snapshot, input, entry, matches) {
  // Check expansion before materializing repeated replacement text.
  const estimate = snapshot.bytes + matches * (Buffer.byteLength(input.newText) - Buffer.byteLength(input.oldText));
  if (estimate > TEXT_BYTES) return null;
  const body = snapshot.body.replaceAll(input.oldText, () => input.newText);
  const payload = { token: snapshot.first.token, body, ...(input.description === undefined ? {} : { description: input.description }) };
  const bytes = Buffer.byteLength(entry === undefined ? JSON.stringify(payload) : body);
  return bytes > TEXT_BYTES ? null : payload;
}

export async function editText(api, input) {
  const name = capsuleName(input.name);
  const entry = input.entry === undefined ? undefined : entryPath(input.entry);
  if (input.dryRun !== undefined && typeof input.dryRun !== "boolean") throw invalid("dryRun需要布尔值");
  if ((!input.dryRun || input.token !== undefined) && (typeof input.token !== "string" || !input.token))
    throw invalid("文字替换需要读取时的token");
  if (typeof input.oldText !== "string" || !input.oldText || input.oldText.includes("\0") ||
      typeof input.newText !== "string" || input.newText.includes("\0"))
    throw invalid("需要非空oldText与文本newText，且不能含空字符");
  if (input.all !== undefined && typeof input.all !== "boolean") throw invalid("all需要布尔值");
  if (input.description !== undefined && (entry !== undefined || typeof input.description !== "string" || input.description.length > 180))
    throw invalid("简述仅可随统一详述修改，最多180字符");

  const snapshot = await readForEdit(api, name, entry, input.token);
  const { first } = snapshot;
  const matches = matchCount(snapshot.body, input.oldText);
  let payload, blockedBy, reason;
  if (!matches) {
    blockedBy = "NO_MATCH";
    reason = "原文没有匹配，未写入";
  } else if (matches > 1 && !input.all) {
    blockedBy = "MULTIPLE_MATCHES";
    reason = "原文匹配多处，请使用--all明确替换全部";
  } else {
    payload = replacementPayload(snapshot, input, entry, matches);
    if (!payload) {
      blockedBy = "TEXT_TOO_LARGE";
      reason = "替换后的写入请求超过1MiB，未写入";
    }
  }
  if (input.dryRun) return {
    dryRun: true, name, ...(entry === undefined ? { source: first.source } : { entry }),
    token: first.token, commit: first.commit,
    lines: { from: 1, to: first.lines.total, total: first.lines.total, nextLine: null, truncated: false },
    matches, canApply: !blockedBy, ...(blockedBy ? { blockedBy, reason } : {}),
  };
  if (blockedBy === "TEXT_TOO_LARGE") throw tooLarge(reason);
  if (blockedBy) throw invalid(reason);

  try {
    const result = entry === undefined
      ? await api.json(api.path(name, "details"), "PUT", payload)
      : await api.putText(name, entry, payload.body, payload.token);
    return { ...result, replacements: matches };
  } catch (error) {
    if (!error.status) { error.unknownResult = true; error.message += "；替换结果未知，请核对stat/history，不能自动重放"; }
    throw error;
  }
}
