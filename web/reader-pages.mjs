import { action } from "./api.mjs";
import { checkedReadPage } from "./read-record.mjs";
import { READER_LIMITS, SectionScanner } from "./reader-structure.mjs";

export const READER_LINES = 200;
const invalid = (message) => Object.assign(new Error(`正文分页响应无效：${message}`), { status: 502, code: "INVALID_RESPONSE" });

export function sectionEnd(body, options = {}) {
  const scanner = new SectionScanner(options);
  for (const line of body.split("\n")) scanner.append(line);
  return scanner.end(options);
}

export async function readSection(name, entry, { from = 1, token, initial, signal, to, markdown = true, minimumLine = from, anchor } = {}) {
  if (!Number.isSafeInteger(from) || from < 1 || to !== undefined && (!Number.isSafeInteger(to) || to < from)) throw invalid("请求范围无效");
  const scanner = new SectionScanner({ markdown, goal: Math.max(READER_LINES, minimumLine - from + 1), anchor });
  let record = initial, next = from, baseline = token, total, commit;
  const finish = (end) => {
    const last = from + end - 1;
    return { ...record, body: scanner.body(end), lines: { from, to: last, total,
      nextLine: last < total ? last + 1 : null, truncated: from !== 1 || last < total } };
  };
  for (let request = 0; request < READER_LIMITS.requests; request++) {
    signal?.throwIfAborted();
    record ||= await action("read", { name, ...(entry === undefined ? {} : { entry }), from: next,
      limit: Math.min(READER_LINES + 40, to === undefined ? READER_LINES + 40 : to - next + 1) }, { signal });
    signal?.throwIfAborted();
    checkedReadPage(record, { from: next, token: baseline, total });
    if (commit !== undefined && record.commit !== commit || entry !== undefined && record.entry !== undefined && record.entry !== entry)
      throw invalid("提交或条目变化");
    if (record.lines.to < record.lines.from) throw invalid("范围为空");
    baseline ??= record.token; total ??= record.lines.total; commit ??= record.commit;
    const lines = record.body.split("\n");
    for (let index = 0; index < lines.length && (to === undefined || next + index <= to); index++) {
      try { scanner.append(lines[index]); }
      catch (error) {
        const end = scanner.end();
        if (error.code === "TEXT_BLOCK_TOO_LARGE" && end !== null && from + end - 1 >= minimumLine && (!anchor || scanner.targetLine)) return finish(end);
        throw error;
      }
    }
    const reachedEnd = to !== undefined && from + scanner.lines.length - 1 >= to;
    if (reachedEnd && !scanner.explicitClosed) throw invalid("返回边界位于表格或代码块内部");
    const end = scanner.end({ complete: reachedEnd || record.lines.nextLine === null });
    if (end !== null && from + end - 1 >= minimumLine && (!anchor || scanner.targetLine)) return finish(end);
    if (record.lines.nextLine === null) throw invalid("定位目标不在返回内容内");
    next = record.lines.nextLine; record = null;
  }
  throw invalid("结构块续读次数超过有界上限，请下载原件查看");
}
