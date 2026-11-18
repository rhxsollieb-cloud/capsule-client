import { action, readText } from "./api.mjs";
import { button, node, replace, releaseMedia } from "./dom.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { canEdit } from "./permissions.mjs";
import { readSection, READER_LINES } from "./reader-pages.mjs";
import { bindReaderShortcuts } from "./reader-shortcuts.mjs";
import { checkedReadPage } from "./read-record.mjs";
import { ReaderPageCache, rememberPage } from "./reader-cache.mjs";
import { containsReaderAnchor } from "./reader-structure.mjs";

export class PagedTextReader {
  constructor(container, cap, entry, { initial, isCurrent, onError, onOpenEntry, onFullEdit, onRead, markdown }) {
    Object.assign(this, { container, cap, entry, isCurrent, onError, onOpenEntry, onFullEdit, onRead, markdown });
    this.history = [];
    this.pages = new ReaderPageCache();
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
  canBack() { return Boolean(this.record && this.record.lines.from > 1); }
  controlsInfo() {
    return { state: this.denied || this.stale ? "error" : "clean", mode: "read", statusText: this.denied ? "无法访问正文" : this.stale ? "阅读版本已变化" : "已保存", detail: this.range.textContent || "正在读取分段",
      helpText: "分段阅读仅加载当前段落和配图。阅读时←上一段、→下一段；输入框和菜单中不翻页。完整载入以编辑会先核对全文、版本及提交大小；分段不会作为整本正文保存。",
      moreItems: canEdit(this.cap) ? [{ label: "完整载入以编辑", disabled: this.busy || this.stale, action: () => this.editEntire() }] : [] };
  }
  updatePermissions(cap) {
    this.cap = { ...this.cap, permissions: cap.permissions };
    if (cap.permissions?.read === false) this.clearAccess(new Error("当前身份已无法读取此正文，请重新选择或检查权限。"));
    else if (this.denied && !this.busy && cap.permissions?.read === true) { this.denied = false; void this.go(1, { push: false }); }
  }
  clearAccess(error) {
    this.controller?.abort(); this.denied = true;
    this.pages.clear(); this.history.length = 0; this.record = null;
    this.cap = { ...this.cap, permissions: { read: false, edit: false, manage: false } };
    releaseMedia(this.body, { images: true });
    replace(this.body, node("p", "error-message", "当前身份无法访问此正文。"));
    this.note.textContent = error.message; this.range.textContent = "无法访问正文"; this.line.value = "";
    this.controls();
  }
  controls() {
    const blocked = this.busy || this.denied || this.stale;
    this.previous.disabled = blocked || !this.canBack();
    this.next.disabled = blocked || !this.record?.lines.nextLine;
    this.line.disabled = blocked;
  }
  async run(operation) {
    if (this.busy || this.denied || this.stale || !this.active()) return;
    this.busy = true; this.controls(); this.note.textContent = "正在读取…";
    this.controller = new AbortController();
    try { await operation(this.controller.signal); }
    catch (error) {
      if (this.active() && error.name !== "AbortError") {
        if ([401, 403, 404].includes(error.status) && error.code !== "TEXT_ANCHOR_NOT_FOUND") this.clearAccess(error);
        if (error.code === "VERSION_CONFLICT" || error.code === "TEXT_CHANGED") { this.pages.clear(); this.stale = true; }
        this.note.textContent = error.message; this.onError(error);
      }
    }
    finally { this.busy = false; if (this.active()) { this.controls(); this.onRead?.(this.record); } }
  }
  async verify(signal) {
    const current = await action("stat", { name: this.cap.name }, { signal });
    signal?.throwIfAborted();
    if (current.token !== this.cap.token || current.commit !== this.cap.commit)
      throw Object.assign(new Error("阅读版本已变化，请检查更新后重新打开；不会展示旧缓存为新内容。"), { status: 409, code: "VERSION_CONFLICT" });
    if (current.permissions?.read === false) throw Object.assign(new Error("当前身份无法读取此正文。"), { status: 403 });
    this.cap = { ...this.cap, permissions: current.permissions };
  }
  async page(from, signal, initial, { to, minimumLine = from, anchor, verified = false } = {}) {
    const cached = this.pages.find((record) => record.lines.from === from && (to === undefined || record.lines.to === to)
      && record.lines.to >= minimumLine && (!anchor || containsReaderAnchor(record.body, anchor)));
    if (cached) { if (!verified) await this.verify(signal); return cached; }
    const record = await readSection(this.cap.name, this.entry, { from, token: this.cap.token, signal, initial, to, minimumLine, anchor, markdown: this.markdown });
    if (record.commit !== this.cap.commit) throw Object.assign(new Error("正文提交已变化，请检查更新后重新打开。"), { status: 409, code: "VERSION_CONFLICT" });
    signal?.throwIfAborted(); this.pages.put(record);
    return record;
  }
  display(record, { push = true } = {}) {
    if (!this.active()) return;
    if (push) rememberPage(this.history, this.record, record);
    this.record = record;
    releaseMedia(this.body, { images: true });
    replace(this.body, this.markdown ? renderMarkdown(record.body, {
      name: this.cap.name, entry: this.entry || "README.md", token: record.token, onOpenEntry: this.onOpenEntry,
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
    if (this.busy || !this.canBack()) return;
    return this.run(async (signal) => {
      const end = this.record.lines.from - 1;
      const previous = this.history.at(-1);
      let record;
      if (previous?.to === end) record = await this.page(previous.from, signal, undefined, { to: end });
      else {
        const cached = this.pages.before(this.record.lines.from);
        if (cached) { await this.verify(signal); record = cached; }
        else {
          const around = Math.max(1, this.record.lines.from - READER_LINES);
          const located = await this.locate({ around }, signal);
          record = await this.page(located.lines.from, signal, located, { to: end, verified: true });
        }
      }
      if (!this.active()) return;
      this.display(record, { push: false });
      if (previous?.to === end) this.history.pop(); else this.history.length = 0;
    });
  }
  async locate(position, signal) {
    const record = checkedReadPage(await action("read", { name: this.cap.name, ...(this.entry === undefined ? {} : { entry: this.entry }), ...position, limit: 1 }, { signal }), { token: this.cap.token, total: this.record?.lines.total });
    signal?.throwIfAborted();
    if (record.commit !== this.cap.commit) throw Object.assign(new Error("定位期间正文提交已变化，请检查更新后重新打开。"), { status: 409, code: "VERSION_CONFLICT" });
    if (position.around !== undefined && record.lines.from > position.around)
      throw Object.assign(new Error("正文定位响应越过了目标行，未显示错误段落。"), { status: 502, code: "INVALID_RESPONSE" });
    return record;
  }
  async sectionFor(line, signal) {
    const cached = this.pages.containing(line);
    if (cached) { await this.verify(signal); return cached; }
    const around = line === this.record.lines.total ? Math.max(1, line - READER_LINES) : line;
    const located = await this.locate({ around }, signal);
    return this.page(located.lines.from, signal, located, { minimumLine: line, verified: true });
  }
  seekLine(line) {
    if (!Number.isSafeInteger(line) || line < 1 || line > this.record?.lines.total) { this.note.textContent = "请输入正文范围内的行号。"; return; }
    return this.run(async (signal) => this.display(await this.sectionFor(line, signal)));
  }
  seekAnchor(id) {
    return this.run(async (signal) => {
      this.note.textContent = "正在定位目录…";
      const located = await this.locate({ anchor: id }, signal);
      this.display(await this.page(located.lines.from, signal, located, { anchor: id, verified: true }));
      [...this.body.querySelectorAll("[id]")].find((element) => element.id === id)?.scrollIntoView({ block: "start" });
    });
  }
  editEntire() {
    return this.run(async (signal) => {
      const record = await readText(this.cap.name, this.entry, () => this.active(), { signal, token: this.cap.token });
      if (record && this.active()) await this.onFullEdit(record);
    });
  }
  destroy() {
    this.destroyed = true;
    this.controller?.abort();
    this.pages.clear(); this.history.length = 0; this.record = null;
    this.unbindShortcuts();
    this.controlsResize.disconnect();
    releaseMedia(this.body, { images: true });
  }
}
