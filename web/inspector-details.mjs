import { action, contentUrl } from "./api.mjs";
import { button, directoryKinds, node, replace } from "./dom.mjs";
import { renderMarkdown } from "./markdown.mjs";

export class InspectorDetails {
  constructor({ isCurrent, getDraft, onEdit, onChange, onError }) {
    Object.assign(this, { isCurrent, getDraft, onEdit, onChange, onError });
    this.element = node("div", "property-details");
    this.heading = node("div", "property-detail-heading");
    this.body = node("div", "property-body");
    this.note = node("p", "property-note");
    this.actions = node("div", "property-detail-actions");
  }
  show(record, draft) {
    this.record = record;
    this.draft = draft;
    this.metadata = record.source.type === "metadata";
    this.read();
  }
  read() {
    this.mode = "read";
    this.input = null;
    replace(this.heading, node("h3", "", "详述"), button(this.metadata ? "编辑详述" : "编辑正文",
      () => { if (this.isCurrent()) return this.metadata ? this.loadEditor() : this.onEdit(this.record); }, "button ghost"));
    replace(this.actions);
    if (this.record.lines.nextLine && !(this.metadata && this.draft.bodyReady))
      this.actions.append(button("加载更多", () => this.more(), "button ghost"));
    replace(this.element, this.heading, this.body, this.note, this.actions);
    this.syncLocal(true);
  }
  renderBody(body, context) {
    return body ? renderMarkdown(body, context) : node("p", "property-empty", "暂无详述");
  }
  syncLocal(force = false) {
    if (this.mode !== "read") return;
    const record = this.record;
    const local = !this.metadata && this.getDraft(record.name, record.source.entry);
    let body = record.body;
    if (this.metadata && this.draft.bodyReady) {
      body = this.draft.body;
      this.note.textContent = body !== this.draft.originalBody ? "当前未保存详述" : "";
    } else if (local?.dirty) {
      body = local.body;
      this.note.textContent = "当前未保存正文 · 与中央编辑器使用同一份草稿";
    } else {
      this.note.textContent = record.lines.nextLine ? `已读取 ${record.lines.to} / ${record.lines.total} 行` : this.metadata ? "" : "详述即正文，不另存副本";
    }
    const context = directoryKinds.has(record.kind) ? { name: record.name, entry: record.source.entry } : {};
    const key = JSON.stringify(context);
    if (force || body !== this.renderedBody || key !== this.renderedContext) {
      replace(this.body, this.renderBody(body, context));
      this.renderedBody = body;
      this.renderedContext = key;
    }
  }
  edit(body) {
    this.mode = "edit";
    this.draft.bodyReady = true;
    const input = node("textarea", "property-input property-details-input");
    input.value = body;
    input.rows = 9;
    input.placeholder = "支持 Markdown";
    input.setAttribute("aria-label", "详述");
    input.addEventListener("input", () => { this.draft.body = input.value; this.onChange(); });
    replace(this.heading, node("h3", "", "详述"), button("阅读", () => { if (this.isCurrent()) this.read(); }, "button ghost"));
    replace(this.element, this.heading, input);
    this.input = input;
  }
  async more() {
    if (this.loading || !this.record.lines.nextLine) return;
    this.loading = true;
    const record = this.record;
    try {
      const next = await action("details", { name: record.name, from: record.lines.nextLine, limit: 80 });
      if (!this.isCurrent() || this.record !== record) return;
      if (next.token !== record.token) throw new Error("详述在读取期间已变化，请关闭后重新打开；未保存说明会保留。");
      record.body += `\n${next.body}`;
      record.lines = next.lines;
      this.show(record, this.draft);
    } catch (error) { if (this.isCurrent()) this.onError(error); }
    finally { this.loading = false; }
  }
  async loadEditor() {
    if (this.loading) return;
    if (this.draft.bodyReady) { this.edit(this.draft.body); return; }
    this.loading = true;
    const record = this.record;
    try {
      let body = record.body;
      let nextLine = record.lines.nextLine;
      while (nextLine) {
        const next = await action("details", { name: record.name, from: nextLine, limit: 10000 });
        if (!this.isCurrent() || this.record !== record) return;
        if (next.token !== record.token) throw new Error("详述已变化，请关闭后重新打开；未保存说明会保留。");
        body += `\n${next.body}`;
        nextLine = next.lines.nextLine;
      }
      if (!this.isCurrent() || this.record !== record) return;
      this.draft.body = body;
      this.draft.originalBody = body;
      this.edit(body);
    } catch (error) { if (this.isCurrent()) this.onError(error); }
    finally { this.loading = false; }
  }
}

export function mediaBrowser(cap) {
  if (!["image", "audio", "video"].includes(cap.kind)) return null;
  const wrapper = node("details", "property-browser");
  wrapper.append(node("summary", "", "浏览"));
  wrapper.addEventListener("toggle", () => {
    if (!wrapper.open) { for (const media of wrapper.querySelectorAll("audio, video")) media.pause(); return; }
    if (wrapper.querySelector("img, audio, video")) return;
    const media = node(cap.kind === "image" ? "img" : cap.kind, "property-media");
    media.src = contentUrl(cap.name);
    if (cap.kind === "image") media.alt = cap.name;
    else { media.controls = true; media.preload = "metadata"; }
    const error = node("p", "error-message hidden", "原件暂时无法浏览，可从节点打开后下载核对。");
    media.addEventListener("error", () => error.classList.remove("hidden"));
    wrapper.append(media, error);
  });
  return wrapper;
}
