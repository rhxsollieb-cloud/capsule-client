import { capsuleName } from "../system/paths.mjs";
import { virtualPath } from "./mounts.mjs";

export const overview = (api) => api.json("/api/overview");
export const whereCapsule = (api, name, page = {}) => api.json(api.path(capsuleName(name), "positions", page));
export const searchCapsules = (api, input = {}) => api.json(api.query("/api/search", { ...input, path: virtualPath(input.path || "/") }));

const scanPages = 20;
const scanFileChars = 2 * 1024 * 1024;
const scanOffsetLimit = 1_000_000;

function checkSearchPage(page, offset) {
  const { scanned, total, nextOffset } = page ?? {};
  if (!Array.isArray(page?.items) || page.items.some((item) => !item || typeof item.name !== "string" || !item.name) ||
      page.returned !== page.items.length || !Number.isSafeInteger(total) || total < 0 ||
      scanned?.from !== offset || scanned.total !== total || !Number.isSafeInteger(scanned.to) || scanned.to < offset ||
      scanned.to > Math.max(offset, total) || page.items.length > scanned.to - offset || typeof page.truncated !== "boolean" ||
      (page.incomplete !== undefined && !Array.isArray(page.incomplete)) ||
      (page.incompleteTruncated !== undefined && typeof page.incompleteTruncated !== "boolean") ||
      (nextOffset === null ? scanned.to < total : nextOffset !== scanned.to || nextOffset <= offset || nextOffset >= total)) {
    throw Object.assign(new Error("搜索分页返回的候选范围或续页游标无效"), { status: 502, code: "INVALID_RESPONSE" });
  }
}

export async function scanCapsules(api, input, output = {}) {
  const start = input.offset ?? 0;
  const maxChars = output.outFile ? scanFileChars : output.maxChars ?? 12000;
  let cursor = start;
  let incomplete = false;
  let result;
  for (let pages = 1; pages <= scanPages; pages++) {
    let page;
    try {
      page = await searchCapsules(api, { ...input, offset: cursor });
      checkSearchPage(page, cursor);
    } catch (error) {
      if (result) error.result = { ...result, stopReason: "search-failed" };
      throw error;
    }
    if (result && page.total !== result.total) return { ...result, stopReason: "candidate-total-changed" };
    const items = [...(result?.items || []), ...page.items];
    const issues = [...(result?.incomplete || []), ...(page.incomplete || [])];
    const incompleteTruncated = Boolean(result?.incompleteTruncated || page.incompleteTruncated);
    incomplete ||= Boolean(issues.length || incompleteTruncated || page.items.some((item) => item.matchesTruncated || item.positionsTruncated) ||
      (page.nextOffset === null && page.truncated));
    const candidate = {
      items, total: page.total, returned: items.length, pages,
      scanned: { from: start, to: page.scanned.to, total: page.total },
      nextOffset: page.nextOffset, truncated: page.nextOffset !== null || incomplete,
      ...(issues.length || incompleteTruncated ? { incomplete: issues, incompleteTruncated } : {}),
    };
    if (JSON.stringify({ ...candidate, stopReason: "candidate-total-changed" }, null, 2).length > maxChars) {
      const accepted = result || {
        items: [], total: page.total, returned: 0, pages: 0,
        scanned: { from: start, to: start, total: page.total }, nextOffset: cursor, dataOmitted: true,
        hint: "候选页超过输出预算，可减小--limit或通过--out保存",
      };
      return { ...accepted, truncated: true, stopReason: "output-limit" };
    }
    result = candidate;
    if (page.nextOffset === null) return result;
    if (page.nextOffset > scanOffsetLimit) return { ...result, stopReason: "offset-limit" };
    cursor = page.nextOffset;
  }
  return { ...result, stopReason: "page-limit" };
}
