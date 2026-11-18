export const READER_LIMITS = Object.freeze({ lines: 10000, bytes: 2 * 1024 * 1024, requests: 64 });
const encoder = new TextEncoder();
const tooLarge = () => Object.assign(new Error("单个正文结构块超过阅读上限（2MiB或10000行），请下载原件查看；不会截断表格或代码。"), { status: 413, code: "TEXT_BLOCK_TOO_LARGE" });

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
    if (this.markdown && !this.fence) {
      visible = visible.replace(/<!--[\s\S]*?-->/g, "");
      const open = visible.indexOf("<!--");
      if (open >= 0) { visible = visible.slice(0, open); this.comment = true; }
    }
    const delimiter = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(visible);
    if (this.markdown && this.explicitClosed && delimiter && this.previous?.includes("|") && this.previous.trim()) {
      this.pipe = true;
      const header = this.lines.length - 1;
      // A header only becomes a table when the following delimiter arrives.
      for (const key of ["lastBoundary", "firstFollowing", "firstLineAfterGoal"]) if (this[key] >= header) delete this[key];
    }
    if (!visible.trim()) this.pipe = false;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(visible.replace(/^(?: {0,3}> ?)+/, ""));
    if (this.markdown && marker && (this.fence || !this.tableDepth && !this.pipe)) {
      if (!this.fence && (marker[1][0] !== "`" || !marker[2].includes("`"))) this.fence = { character: marker[1][0], length: marker[1].length };
      else if (this.fence && marker[1][0] === this.fence.character && marker[1].length >= this.fence.length && !marker[2].trim()) this.fence = null;
    }
    if (this.markdown && !this.fence) {
      this.tableDepth += (visible.match(/<table\b[^>]*>/gi) || []).length;
      this.tableDepth -= (visible.match(/<\/table\s*>/gi) || []).length;
      this.tableDepth = Math.max(0, this.tableDepth);
    }
    if (this.anchor && !this.targetLine && !this.fence) {
      for (const match of visible.matchAll(/<a\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi)) if (match[1] === this.anchor) {
        this.targetLine = this.lines.length; this.goal = Math.max(this.baseGoal, this.targetLine);
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
