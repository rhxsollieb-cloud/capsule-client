export const limits = Object.freeze({
  fileBytes: 16 * 1024 * 1024,
  archiveBytes: 64 * 1024 * 1024,
  xmlBytes: 8 * 1024 * 1024,
  totalXmlBytes: 24 * 1024 * 1024,
  archiveEntries: 2000,
  xmlNodes: 60000,
  xmlDepth: 64,
  sheets: 8,
  rows: 200,
  columns: 30,
  blocks: 800,
  textCharacters: 300000,
  cellCharacters: 4000,
});

export function previewError(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

export class TextBudget {
  constructor() {
    this.remaining = limits.textCharacters;
    this.truncated = false;
  }
  take(value) {
    const maximum = Math.min(limits.cellCharacters, this.remaining);
    const text = String(value ?? "");
    const result = text.slice(0, maximum);
    if (result.length !== text.length) this.truncated = true;
    this.remaining -= result.length;
    return result;
  }
}
