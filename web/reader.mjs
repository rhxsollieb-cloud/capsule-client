import { action, readText } from "./api.mjs";
import { button, node, replace, releaseMedia } from "./dom.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { canEdit } from "./permissions.mjs";
import { readSection } from "./reader-pages.mjs";
import { bindReaderShortcuts } from "./reader-shortcuts.mjs";

export class PagedTextReader {
  constructor(container, cap, entry, { initial, isCurrent, onError, onOpenEntry, onFullEdit, onRead, markdown }) {
    Object.assign(this, { container, cap, entry, isCurrent, onError, onOpenEntry, onFullEdit, onRead, markdown });
    this.history = [];
    this.boundaries = new Map();
    this.anchors = new Map();
    this.wrapper = node("div", "paged-reader");
    this.previous = button("上一段", () => this.back(), "button secondary");
    this.next = button("下一段", () => this.go(this.record.lines.nextLine), "button secondary");
    this.previous.title = "上一段（←）";
    this.previous.setAttribute("aria-keyshortcuts", "ArrowLeft");
    this.next.title = "下一段（→）";
    this.next.setAttribute("aria-keyshortcuts", "ArrowRight");
    this.range = node("span", "reader-range");
    this.line = node("input", "property-input reader-line");
    this.line.type = "number"; this.line.min = "1"; this.line.value = "1";
    this.line.setAttribute("aria-label", "跳转到行");
    const jump = button("跳转", () => this.seekLine(Number(this.line.value)), "button ghost");
    const controls = node("nav", "reader-controls");
    controls.setAttribute("aria-label", "阅读分页");
    controls.append(this.previous, this.next, this.range, this.line, jump);
    this.note = node("p", "reader-note"); this.note.setAttribute("role", "status");
    this.body = node("div", "reading-surface reader-surface");
    this.body.tabIndex = 0;
    this.body.setAttribute("role", "region");
    this.body.setAttribute("aria-label", "分段正文");
    this.wrapper.append(this.note, this.body, controls);
    replace(container, this.wrapper);
    this.unbindShortcuts = bindReaderShortcuts(this);
    this.controlsResize = new ResizeObserver(() => {
      this.wrapper.style.setProperty("--reader-controls-height", `${controls.offsetHeight}px`);
    });
    this.controlsResize.observe(controls);
    this.ready = this.go(initial.lines.from, { initial, push: false });
  }
  active() { return !this.destroyed && this.isCurrent(); }
  controlsInfo() {
    return { state: "clean", mode: "read", detail: this.range.textContent || "正在读取分段",
      helpText: "分段阅读仅加载当前段落和配图。阅读时←上一段、→下一段；输入框和菜单中不翻页。完整载入以编辑会先核对全文、版本及提交大小；分段不会作为整本正文保存。",
      moreItems: canEdit(this.cap) ? [{ label: "完整载入以编辑", disabled: this.busy, action: () => this.editEntire() }] : [] };
  }
  updatePermissions(cap) { this.cap = { ...this.cap, permissions: cap.permissions }; }
  controls() {
    this.previous.disabled = this.busy || !this.history.length;
    this.next.disabled = this.busy || !this.record?.lines.nextLine;
    this.line.disabled = this.busy;
  }
  async run(operation) {
    if (this.busy || !this.active()) return;
    this.busy = true; this.controls(); this.note.textContent = "正在读取…";
    this.controller = new AbortController();
    try { await operation(this.controller.signal); }
    catch (error) { if (this.active() && error.name !== "AbortError") { this.note.textContent = error.message; this.onError(error); } }
    finally { this.busy = false; if (this.active()) { this.controls(); this.onRead?.(this.record); } }
  }
  async page(from, signal, initial) {
    const record = await readSection(this.cap.name, this.entry, { from, token: this.cap.token, signal, initial });
    this.boundaries.set(from, record.lines.to);
    const lines = record.body.split("\n");
    for (let index = 0; index < lines.length; index++) for (const match of lines[index].matchAll(/<a\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi))
      this.anchors.set(match[1], from + index);
    return record;
  }
  display(record, { push = true } = {}) {
    if (!this.active()) return;
    if (push && this.record) this.history.push(this.record.lines.from);
    this.record = record;
    releaseMedia(this.body, { images: true });
    replace(this.body, this.markdown ? renderMarkdown(record.body, {
      name: this.cap.name, entry: this.entry || "README.md", onOpenEntry: this.onOpenEntry,
      onAnchor: (id) => this.seekAnchor(id),
    }) : node("pre", "text-reading", record.body));
    this.range.textContent = `第 ${record.lines.from}–${record.lines.to} 行 / 共 ${record.lines.total} 行`;
    this.line.max = String(record.lines.total); this.line.value = String(record.lines.from);
    this.note.textContent = "";
    this.body.scrollTop = 0;
    this.container.scrollTop = 0;
  }
  go(from, { initial, push = true } = {}) {
    if (!Number.isSafeInteger(from) || from < 1) return;
    return this.run(async (signal) => this.display(await this.page(from, signal, initial), { push }));
  }
  back() {
    if (this.busy || !this.history.length) return;
    const from = this.history.at(-1);
    return this.run(async (signal) => {
      const record = await this.page(from, signal);
      if (!this.active()) return;
      this.display(record, { push: false });
      this.history.pop();
    });
  }
  async sectionFor(line, signal) {
    let from = 1;
    for (const [start, end] of this.boundaries) if (start <= line && end >= line) return this.page(start, signal);
    for (const [, end] of this.boundaries) if (end < line) from = Math.max(from, end + 1);
    for (;;) {
      const record = await this.page(from, signal);
      if (record.lines.to >= line || !record.lines.nextLine) return record;
      from = record.lines.nextLine;
    }
  }
  seekLine(line) {
    if (!Number.isSafeInteger(line) || line < 1 || line > this.record?.lines.total) { this.note.textContent = "请输入正文范围内的行号。"; return; }
    return this.run(async (signal) => this.display(await this.sectionFor(line, signal)));
  }
  seekAnchor(id) {
    return this.run(async (signal) => {
      let line = this.anchors.get(id);
      let from = 1;
      while (!line) {
        this.note.textContent = "正在定位目录…";
        const record = await action("read", { name: this.cap.name, entry: this.entry, from, limit: 1000 }, { signal });
        if (record.token !== this.cap.token) throw new Error("目录定位期间版本已变化，请检查更新后重新打开。");
        const lines = record.body.split("\n");
        for (let index = 0; index < lines.length; index++) for (const match of lines[index].matchAll(/<a\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi))
          this.anchors.set(match[1], from + index);
        line = this.anchors.get(id);
        if (!record.lines.nextLine) break;
        from = record.lines.nextLine;
      }
      if (!line) { this.note.textContent = `未找到目录锚点 ${id}，可按行号浏览全文。`; return; }
      this.display(await this.sectionFor(line, signal));
      [...this.body.querySelectorAll("[id]")].find((element) => element.id === id)?.scrollIntoView({ block: "start" });
    });
  }
  editEntire() {
    return this.run(async () => {
      const record = await readText(this.cap.name, this.entry, () => this.active());
      if (record && this.active()) await this.onFullEdit(record);
    });
  }
  destroy() {
    this.destroyed = true;
    this.controller?.abort();
    this.unbindShortcuts();
    this.controlsResize.disconnect();
    releaseMedia(this.body, { images: true });
  }
}
