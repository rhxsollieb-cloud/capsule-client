export const READER_LIMITS = Object.freeze({ lines: 10000, bytes: 2 * 1024 * 1024, requests: 64 });
const encoder = new TextEncoder();
const tooLarge = () => Object.assign(new Error("单个正文结构块超过阅读上限（2MiB或10000行），请下载原件查看；不会截断表格或代码。"), { status: 413, code: "TEXT_BLOCK_TOO_LARGE" });

function pipeDelimiter(line) {
  const text = line.trim();
  if (!text.includes("|")) return false;
  let start = text.startsWith("|") ? 1 : 0;
  const end = text.endsWith("|") ? text.length - 1 : text.length;
  let cells = 0;
  while (start < end) {
    const separator = text.indexOf("|", start);
    const stop = separator < 0 || separator >= end ? end : separator;
    if (!/^:?-{3,}:?$/.test(text.slice(start, stop).trim())) return false;
    cells++;
    if (stop === end) return cells >= 2;
    start = stop + 1;
    if (start === end) return false;
  }
  return false;
}

// Only matched spans on this line hide structure. Unmatched backticks remain
// literal, and the bounded run list keeps hostile lines within a fixed budget.
function withoutInlineCode(text) {
  const runs = [], remaining = new Map();
  for (const match of text.matchAll(/`+/g)) {
    if (runs.length === 4096) throw tooLarge();
    const length = match[0].length;
    runs.push({ index: match.index, length });
    remaining.set(length, (remaining.get(length) || 0) + 1);
  }
  let cursor = 0, ticks = 0;
  const parts = [];
  for (const run of runs) {
    remaining.set(run.length, remaining.get(run.length) - 1);
    if (ticks) {
      if (ticks === run.length) { ticks = 0; cursor = run.index + run.length; }
      continue;
    }
    let slash = run.index;
    while (slash > 0 && text[slash - 1] === "\\") slash--;
    if ((run.index - slash) % 2 || !remaining.get(run.length)) continue;
    parts.push(text.slice(cursor, run.index), "\ufffc");
    ticks = run.length; cursor = run.index + run.length;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

function withoutComments(text, state) {
  let cursor = 0;
  const parts = [];
  while (cursor < text.length) {
    if (state.comment) {
      const close = text.indexOf("-->", cursor);
      if (close < 0) break;
      cursor = close + 3; state.comment = false;
    } else {
      const open = text.indexOf("<!--", cursor);
      if (open < 0) { parts.push(text.slice(cursor)); break; }
      parts.push(text.slice(cursor, open)); cursor = open + 4; state.comment = true;
    }
  }
  return parts.join("");
}

function anchorId(tag) {
  let cursor = 2;
  while (cursor < tag.length - 1) {
    while (/\s/.test(tag[cursor])) cursor++;
    if (cursor >= tag.length - 1 || tag[cursor] === "/") return null;
    const start = cursor;
    while (cursor < tag.length - 1 && !/[\s=/>]/.test(tag[cursor])) cursor++;
    if (cursor === start) { cursor++; continue; }
    const name = tag.slice(start, cursor).toLowerCase();
    while (/\s/.test(tag[cursor])) cursor++;
    if (tag[cursor] !== "=") {
      if (name === "id") return null;
      continue;
    }
    cursor++;
    while (/\s/.test(tag[cursor])) cursor++;
    const quote = tag[cursor] === '"' || tag[cursor] === "'" ? tag[cursor++] : null;
    const valueStart = cursor;
    if (quote) {
      cursor = tag.indexOf(quote, cursor);
      if (cursor < 0) return null;
    } else while (cursor < tag.length - 1 && !/\s/.test(tag[cursor])) cursor++;
    const value = tag.slice(valueStart, cursor);
    if (quote) cursor++;
    // Preserve the explicit quoted-id contract, including the first attribute.
    if (name === "id") return quote ? value : null;
  }
  return null;
}

// Incremental state avoids reparsing all preceding chunks of a long block.
export class SectionScanner {
  constructor({ goal = 200, markdown = true, anchor } = {}) {
    Object.assign(this, { goal: anchor ? Infinity : goal, baseGoal: goal, markdown, anchor });
    this.lines = []; this.bytes = 0; this.fence = null; this.tableDepth = 0; this.comment = false; this.pipe = false;
  }
  get explicitClosed() { return !this.fence && !this.tableDepth && !this.comment; }
  get closed() { return this.explicitClosed && !this.pipe; }
  append(line) {
    const bytes = encoder.encode(line).length + (this.lines.length ? 1 : 0);
    if (this.lines.length >= READER_LIMITS.lines || this.bytes + bytes > READER_LIMITS.bytes) throw tooLarge();
    this.bytes += bytes; this.lines.push(line);
    let visible = line;
    if (this.markdown && this.comment) {
      const close = visible.indexOf("-->");
      if (close < 0) { this.previous = ""; return; }
      visible = visible.slice(close + 3); this.comment = false;
    }
    const fenceLine = visible;
    if (this.markdown && !this.fence) visible = withoutComments(withoutInlineCode(visible), this);
    const delimiter = pipeDelimiter(visible);
    if (this.markdown && this.explicitClosed && delimiter && this.previous?.includes("|") && this.previous.trim()) {
      this.pipe = true;
      const header = this.lines.length - 1;
      // A header only becomes a table when the following delimiter arrives.
      for (const key of ["lastBoundary", "firstFollowing", "firstLineAfterGoal"]) if (this[key] >= header) delete this[key];
    }
    if (!visible.trim()) this.pipe = false;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(fenceLine.replace(/^(?: {0,3}> ?)+/, ""));
    if (this.markdown && marker && (this.fence || !this.tableDepth && !this.pipe)) {
      if (!this.fence && (marker[1][0] !== "`" || !marker[2].includes("`"))) this.fence = { character: marker[1][0], length: marker[1].length };
      else if (this.fence && marker[1][0] === this.fence.character && marker[1].length >= this.fence.length && !marker[2].trim()) this.fence = null;
    }
    if (this.markdown && !this.fence) {
      this.tableDepth += (visible.match(/<table(?=[\s/>])[^<>]*>/gi) || []).length;
      this.tableDepth -= (visible.match(/<\/table\s*>/gi) || []).length;
      this.tableDepth = Math.max(0, this.tableDepth);
    }
    if (this.anchor && !this.targetLine && !this.fence) {
      for (const tag of visible.matchAll(/<a(?=[\s/>])[^<>]*>/gi)) {
        if (anchorId(tag[0]) === this.anchor) { this.targetLine = this.lines.length; this.goal = Math.max(this.baseGoal, this.targetLine); }
      }
    }
    const boundary = !this.markdown || !visible.trim() || /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(visible);
    if (this.closed && boundary) {
      this.lastBoundary = this.lines.length;
      if (this.lines.length >= this.goal) this.firstFollowing ??= this.lines.length;
    }
    if (this.closed && this.lines.length >= this.goal) this.firstLineAfterGoal ??= this.lines.length;
    this.previous = visible;
  }
  end({ complete = false } = {}) {
    if (complete) return this.lines.length;
    if (this.firstFollowing) return this.firstFollowing;
    if (this.lastBoundary >= this.goal / 2) return this.lastBoundary;
    // Keep one line of lookahead for a possible pipe-table header.
    if (this.firstLineAfterGoal && (this.firstLineAfterGoal < this.lines.length || !this.previous?.includes("|"))) return this.firstLineAfterGoal;
    if (this.closed && this.bytes >= 256 * 1024 && !this.previous?.includes("|")) return this.lines.length;
    return null;
  }
  body(end) { return this.lines.slice(0, end).join("\n"); }
}

export function containsReaderAnchor(body, anchor) {
  const scanner = new SectionScanner({ anchor });
  for (const line of body.split("\n")) {
    scanner.append(line);
    if (scanner.targetLine) return true;
  }
  return false;
}
