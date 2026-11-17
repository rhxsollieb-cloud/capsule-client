import { action } from "./api.mjs";

export const READER_LINES = 200;
const MAX_SECTION_BYTES = 2 * 1024 * 1024;

// Break at paragraph boundaries without cutting a fenced block or raw table.
export function sectionEnd(body, { complete = false, goal = READER_LINES } = {}) {
  const lines = body.split("\n");
  if (complete) return lines.length;
  let fence = null;
  let tableDepth = 0;
  const boundaries = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    }
    if (!fence) {
      tableDepth += (line.match(/<table\b[^>]*>/gi) || []).length;
      tableDepth -= (line.match(/<\/table\s*>/gi) || []).length;
      tableDepth = Math.max(0, tableDepth);
    }
    if (!fence && !tableDepth && (!line.trim() || /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line))) boundaries.push(index + 1);
  }
  const following = boundaries.find((line) => line >= goal);
  if (following) return following;
  const previous = boundaries.at(-1);
  if (previous >= goal / 2) return previous;
  // An exceptionally long ordinary paragraph can be split between complete
  // source lines; structural blocks continue until their closing delimiter.
  if (!fence && !tableDepth && new TextEncoder().encode(body).length >= 256 * 1024) return lines.length;
  return null;
}

export async function readSection(name, entry, { from = 1, token, initial, signal } = {}) {
  let record = initial;
  const parts = [];
  let next = from;
  let baseline = token;
  for (;;) {
    record ||= await action("read", { name, ...(entry === undefined ? {} : { entry }), from: next, limit: READER_LINES + 40 }, { signal });
    baseline ||= record.token;
    if (record.token !== baseline) throw Object.assign(new Error("阅读期间内容已变化，请检查更新后重新打开；不会拼接不同版本。"), { status: 409 });
    parts.push(record.body);
    const body = parts.join("\n");
    const complete = record.lines.nextLine === null || record.lines.nextLine === undefined;
    const end = sectionEnd(body, { complete });
    if (end !== null) {
      const to = from + end - 1;
      return { ...record, body: body.split("\n").slice(0, end).join("\n"), lines: {
        from, to, total: record.lines.total, nextLine: to < record.lines.total ? to + 1 : null,
        truncated: from !== 1 || to < record.lines.total,
      } };
    }
    if (new TextEncoder().encode(body).length > MAX_SECTION_BYTES)
      throw Object.assign(new Error("单个表格或代码块过大，无法安全分段；请下载原件查看。"), { status: 413 });
    next = record.lines.nextLine;
    record = null;
  }
}
