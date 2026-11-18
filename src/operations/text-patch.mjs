import { createHash } from "node:crypto";
import { capsuleName, entryPath } from "../system/paths.mjs";

export const patchBytes = 1024 * 1024;
export const patchError = (message, status = 400, code = "BAD_REQUEST") => Object.assign(new Error(message), { status, code });
export const contentDigest = (text) => createHash("sha256").update(text).digest("hex");
const text = (value) => typeof value === "string" && !value.includes("\0") && value.isWellFormed();
const hex = (value, sizes) => typeof value === "string" && sizes.includes(value.length) && /^[a-f0-9]+$/.test(value);
const hasOnly = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

export function validatePatchItems(input, { planned = false } = {}) {
  if (!Array.isArray(input) || !input.length || input.length > 32) throw patchError("文字修改清单需要1至32个cap");
  const keys = ["name", "entry", "replacements", ...(planned ? ["token", "commit", "digest"] : [])];
  const names = new Set();
  let total = 0;
  return input.map((item) => {
    if (!hasOnly(item, keys)) throw patchError("文字修改清单项字段无效");
    const name = capsuleName(item.name);
    const key = name.toLocaleLowerCase("en-US");
    if (names.has(key)) throw patchError(`每个cap只接受一个原件修改项：${name}`);
    names.add(key);
    const entry = item.entry === undefined ? undefined : entryPath(item.entry);
    if (planned && (!entry || !hex(item.token, [64]) || !hex(item.commit, [40, 64]) || !hex(item.digest, [64])))
      throw patchError(`计划缺少有效的原件、版本或预演校验值：${name}`);
    if (!Array.isArray(item.replacements) || !item.replacements.length || (total += item.replacements.length) > 100)
      throw patchError("清单最多100条精确替换，每个cap至少一条");
    const replacements = item.replacements.map((replacement) => {
      if (!hasOnly(replacement, ["oldText", "newText", "expected"])) throw patchError("精确替换字段无效");
      const { oldText, newText, expected = 1 } = replacement;
      if (!text(oldText) || !oldText || !text(newText) || oldText === newText || !Number.isSafeInteger(expected) || expected < 1 || expected > 1000)
        throw patchError("每条替换需要不同的oldText与newText、1至1000个预期匹配；新文可为空");
      return { oldText, newText, expected };
    });
    return { name, entry, replacements, ...(planned ? { token: item.token, commit: item.commit, digest: item.digest } : {}) };
  });
}

export function readPatchPlan(value) {
  const plan = value?.plan;
  if (value?.prepared !== true || value.dryRun !== true || value.canApply !== true ||
      !hasOnly(plan, ["operation", "version", "items", "reviewDigest"]) || plan.operation !== "edit" || plan.version !== 1)
    throw patchError("需要可执行的edit预演文件，请先使用--prepare");
  const items = validatePatchItems(plan.items, { planned: true });
  if (plan.reviewDigest !== contentDigest(JSON.stringify(plan.items))) throw patchError("预演内容已被修改，请重新生成计划");
  return items;
}

export function patchText(original, replacements) {
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = original.slice(bom.length);
  const crlf = body.includes("\r\n") && !/[\r\n]/.test(body.replaceAll("\r\n", ""));
  const lineEndings = (value) => crlf ? value.replace(/\r?\n/g, "\r\n") : value;
  const changes = [];
  const matches = replacements.map(({ oldText, newText, expected }, index) => {
    const old = lineEndings(oldText), value = lineEndings(newText);
    const delta = Buffer.byteLength(value) - Buffer.byteLength(old);
    let count = 0;
    for (let start = body.indexOf(old); start !== -1; start = body.indexOf(old, start + old.length)) {
      if (++count <= expected) changes.push({ start, end: start + old.length, value, delta });
    }
    return { index: index + 1, matches: count, expected };
  });
  if (matches.some((item) => item.matches !== item.expected))
    return { matches, blockedBy: "MATCH_COUNT_CHANGED", reason: "原文匹配数与清单不符" };
  if (changes.length > 10000) return { matches, blockedBy: "TOO_MANY_REPLACEMENTS", reason: "单个正文最多替换10000处" };
  changes.sort((a, b) => a.start - b.start);
  let offset = 0, bytes = Buffer.byteLength(original);
  const parts = [bom];
  for (const { start, end, value, delta } of changes) {
    if (start < offset) return { matches, blockedBy: "OVERLAPPING_MATCHES", reason: "多处修改命中了同一段原文" };
    bytes += delta;
    parts.push(body.slice(offset, start), value);
    offset = end;
  }
  if (bytes > patchBytes) return { matches, blockedBy: "TEXT_TOO_LARGE", reason: "修改后原件超过1MiB" };
  parts.push(body.slice(offset));
  const updated = parts.join("");
  if (updated === original) return { matches, blockedBy: "NO_CHANGES", reason: "替换后的原件没有变化" };
  return { matches, body: updated };
}
