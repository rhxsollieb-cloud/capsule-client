export const HISTORY_LIMIT = 128;

export class ReaderPageCache {
  constructor({ maxPages = 8, maxBytes = 4 * 1024 * 1024 } = {}) {
    Object.assign(this, { maxPages, maxBytes }); this.items = new Map(); this.bytes = 0;
  }
  clear() { this.items.clear(); this.bytes = 0; }
  put(record) {
    const key = `${record.lines.from}:${record.lines.to}`;
    const bytes = Math.max(new TextEncoder().encode(record.body).length, record.body.length * 2);
    if (this.items.has(key)) { this.bytes -= this.items.get(key).bytes; this.items.delete(key); }
    if (bytes > this.maxBytes) return;
    this.items.set(key, { record, bytes }); this.bytes += bytes;
    while (this.items.size > this.maxPages || this.bytes > this.maxBytes) {
      const first = this.items.keys().next().value;
      this.bytes -= this.items.get(first).bytes; this.items.delete(first);
    }
  }
  find(predicate) {
    const found = [...this.items].reverse().find(([, item]) => predicate(item.record));
    if (!found) return null;
    this.items.delete(found[0]); this.items.set(...found);
    return found[1].record;
  }
  from(line, to) { return this.find((record) => record.lines.from === line && (to === undefined || record.lines.to === to)); }
  containing(line) { return this.find((record) => record.lines.from <= line && record.lines.to >= line); }
  before(line) { return this.find((record) => record.lines.to === line - 1); }
}

// Only adjacent forward traversal belongs in "previous segment" history.
export function rememberPage(history, previous, next) {
  if (!previous || previous.lines.from === next.lines.from) return;
  if (previous.lines.nextLine !== next.lines.from) { history.length = 0; return; }
  history.push({ from: previous.lines.from, to: previous.lines.to });
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
}
