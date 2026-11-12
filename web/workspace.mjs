import { action, readText } from "./api.mjs";
import { button, directoryKinds, fileKind, kindLabels, node, replace, shortCommit } from "./dom.mjs";
import { icon } from "./icons.mjs";
import { TextEditor } from "./editor.mjs";
import { DatabaseView } from "./database.mjs";
import { downloadButton, emptyView, filesView, fileView, historyView, mediaView } from "./views.mjs";

export class Workspace {
  constructor({ inspector, onError, onChanged, onCreate, onRun, onUpload, onRevert }) {
    Object.assign(this, { inspector, onError, onChanged, onCreate, onRun, onUpload, onRevert });
    this.content = document.getElementById("content");
    this.selection = 0;
    this.viewRequest = 0;
    this.editor = new TextEditor({
      onSaved: (cap, options) => this.saved(cap, options),
      onError,
      onDirty: () => this.chrome(),
    });
    emptyView(this.content, onCreate);
  }
  hasDirty() { return this.cap && this.editor.hasDirty(this.cap.name, this.entry); }
  async select(item) {
    const selected = ++this.selection;
    this.item = item;
    this.cap = null;
    this.entry = undefined;
    replace(this.content, node("p", "loading", "正在读取 cap…"));
    try {
      const cap = await action("stat", { name: item.name });
      if (selected !== this.selection) return;
      this.cap = cap;
      this.inspector.show(cap);
      this.mode = cap.kind === "database" ? "database" : directoryKinds.has(cap.kind) ? "files" : "content";
      this.chrome();
      await this.load();
    } catch (error) {
      if (selected === this.selection) replace(this.content, node("p", "error-message file-empty", error.message));
      this.onError(error);
    }
  }
  chrome() {
    if (!this.cap) return;
    const cap = this.cap;
    const tab = node("div", "editor-tab active");
    tab.append(icon(this.entry ? fileKind(this.entry) : cap.kind), node("span", "", this.entry?.split("/").at(-1) || cap.name));
    if (this.hasDirty()) tab.append(node("span", "dirty-indicator", "●"));
    replace(document.getElementById("editor-tabs"), tab);
    const crumbs = [node("span", "", this.item?.path || cap.name)];
    if (this.entry) crumbs.push(node("span", "muted", "›"), node("span", "mono", this.entry));
    replace(document.getElementById("breadcrumbs"), ...crumbs);
    document.getElementById("status-context").textContent = `${kindLabels[cap.kind]} · ${shortCommit(cap.commit)}${this.hasDirty() ? " · 未保存" : ""}`;
    const actions = document.getElementById("content-actions");
    const controls = [];
    if (directoryKinds.has(cap.kind)) controls.push(button("文件", () => this.showFiles(), this.mode === "files" ? "button active ghost" : "button ghost"));
    if (cap.kind === "database") controls.push(button("数据", () => this.showDatabase(), this.mode === "database" ? "button active ghost" : "button ghost"));
    if (cap.kind === "code") {
      const run = button("运行", () => this.onRun(cap, this.hasDirty()), "button ghost");
      run.prepend(icon("play"));
      run.disabled = !cap.runtime;
      run.title = cap.runtime ? "同步服务端版本后本地运行" : "此 cap 尚未配置运行入口";
      controls.push(run);
    }
    const upload = button("上传", () => this.onUpload(cap, this.entry), "button ghost");
    upload.prepend(icon("upload"));
    const history = button("历史", () => this.showHistory(), this.mode === "history" ? "button active ghost" : "button ghost");
    history.prepend(icon("history"));
    const refresh = button("", () => this.refresh(true), "icon-button");
    refresh.append(icon("refresh"));
    refresh.title = "刷新已保存版本，保留草稿";
    refresh.setAttribute("aria-label", refresh.title);
    controls.push(upload, history, refresh);
    if (!directoryKinds.has(cap.kind) || this.entry) controls.push(downloadButton(cap.name, this.entry));
    replace(actions, ...controls);
  }
  async load({ background = false } = {}) {
    if (!this.cap) return;
    const selected = this.selection;
    const request = ++this.viewRequest;
    const cap = this.cap;
    const entry = this.entry;
    const isCurrent = () => selected === this.selection && request === this.viewRequest;
    this.database = null;
    if (this.mode === "history") {
      await historyView(this.content, cap, isCurrent, (target) => this.onRevert(this.cap, target, this.hasDirty()), this.onError);
      return;
    }
    if (this.mode === "database") {
      this.database = new DatabaseView(this.content, cap, { isCurrent, onError: this.onError });
      if (isCurrent()) this.displayedCommit = cap.commit;
      return;
    }
    if (this.mode === "files") {
      if (!background) replace(this.content, node("p", "loading", "正在读取文件…"));
      try {
        this.filePage = await action("entries", { name: cap.name, limit: 100 });
        if (isCurrent()) this.renderFiles(isCurrent);
      } catch (error) { if (isCurrent()) this.showError(error); }
      this.displayedCommit = cap.commit;
      return;
    }
    const kind = fileKind(entry || cap.name, entry ? "file" : cap.kind);
    if (["image", "audio", "video"].includes(kind)) {
      mediaView(this.content, cap, entry);
      this.displayedCommit = cap.commit;
      return;
    }
    if (["file", "excel", "word"].includes(kind)) {
      fileView(this.content, cap, entry);
      this.displayedCommit = cap.commit;
      return;
    }
    if (!background) replace(this.content, node("p", "loading", "正在读取正文…"));
    try {
      const record = await readText(cap.name, entry, isCurrent);
      if (!record || !isCurrent()) return;
      if (background && this.editor.hasDirty(cap.name, entry)) {
        this.editor.markRemote(cap.name, entry);
        return;
      }
      this.cap = { ...this.cap, description: record.description ?? this.cap.description, runtime: record.runtime, commit: record.commit, token: record.token };
      this.editor.open(this.content, this.cap, entry, record);
      this.displayedCommit = record.commit;
      this.chrome();
    } catch (error) {
      if (!isCurrent()) return;
      if (error.status === 400 || error.status === 413) fileView(this.content, cap, entry, error.message);
      else this.showError(error);
    }
  }
  renderFiles(isCurrent) {
    filesView(this.content, this.cap, this.filePage, (entry) => this.openFile(entry), async (offset) => {
      try {
        const more = await action("entries", { name: this.cap.name, limit: 100, offset });
        if (!isCurrent()) return;
        this.filePage = { ...more, items: [...this.filePage.items, ...more.items] };
        this.renderFiles(isCurrent);
      } catch (error) { this.onError(error); }
    });
  }
  openFile(entry) { this.entry = entry; this.mode = "content"; this.chrome(); this.load(); }
  showFiles() { this.entry = undefined; this.mode = "files"; this.chrome(); this.load(); }
  showDatabase() { this.entry = undefined; this.mode = "database"; this.chrome(); this.load(); }
  showHistory() { this.mode = "history"; this.chrome(); this.load(); }
  showError(error) {
    replace(this.content, node("p", "error-message file-empty", error.message));
    this.onError(error);
  }
  saved(cap, { reload = false } = {}) {
    this.onChanged();
    if (this.cap?.name !== cap.name) return;
    this.cap = cap;
    this.inspector.show(cap);
    this.chrome();
    if (reload) this.refresh(true);
  }
  async refresh(force = false) {
    if (!this.cap || this.refreshing) return;
    const selected = this.selection;
    const name = this.cap.name;
    this.refreshing = true;
    try {
      const cap = await action("stat", { name });
      if (selected !== this.selection) return;
      const changed = cap.commit !== this.cap.commit;
      this.cap = cap;
      this.inspector.show(cap);
      this.chrome();
      if (this.mode === "content" && this.hasDirty()) {
        if (changed) this.editor.markRemote(name, this.entry);
        return;
      }
      if (this.mode === "database" && this.database) {
        if (changed || force) this.database.refresh(cap);
        return;
      }
      if (changed || force || this.displayedCommit !== cap.commit) await this.load({ background: true });
    } catch (error) { if (force) this.onError(error); }
    finally { this.refreshing = false; }
  }
}
