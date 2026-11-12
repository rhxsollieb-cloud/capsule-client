import { action, readText } from "./api.mjs";
import { button, directoryKinds, fileKind, kindLabels, node, replace, shortCommit } from "./dom.mjs";
import { icon } from "./icons.mjs";
import { TextEditor } from "./editor.mjs";
import { downloadButton, emptyView, filesView, fileView, historyView, mediaView } from "./views.mjs";
import { officeView } from "./office.mjs";
import { overviewView } from "./overview.mjs";
import { markdownOutline } from "./markdown.mjs";
import { NativeNavigator } from "./native-navigation.mjs";

export class Workspace {
  constructor({ inspector, onError, onChanged, onCreate, onRun, onUpload, onRevert }) {
    Object.assign(this, { inspector, onError, onChanged, onCreate, onRun, onUpload, onRevert });
    this.content = document.getElementById("content");
    this.selection = 0;
    this.viewRequest = 0;
    this.databaseDrafts = new Map();
    this.navigation = new NativeNavigator({
      onOpenEntry: (entry) => this.openFile(entry),
      onOpenTable: (table) => this.showDatabase(table),
      onError,
    });
    this.editor = new TextEditor({
      onSaved: (cap, options) => this.saved(cap, options),
      onError,
      onDirty: () => this.chrome(),
      onOpenEntry: (entry) => this.openFile(entry),
    });
    emptyView(this.content, onCreate);
  }
  async home(onOpen) {
    if (this.cap) return;
    const selected = this.selection;
    await overviewView(this.content, onOpen, this.onCreate, () => selected === this.selection && !this.cap);
  }
  hasDirty() { return Boolean(this.cap && (this.editor.hasDirty(this.cap.name, this.entry) || this.database?.hasDirty())); }
  async select(item) {
    const selected = ++this.selection;
    this.item = item;
    this.database?.destroy?.();
    this.database = null;
    this.cap = null;
    this.entry = undefined;
    this.navigation.hide();
    replace(this.content, node("p", "loading", "正在读取 cap…"));
    try {
      const cap = await action("stat", { name: item.name });
      if (selected !== this.selection) return;
      this.cap = cap;
      this.databaseTable = undefined;
      this.inspector.show(cap);
      this.inspector.context({ label: "当前 cap", values: [cap.name] });
      this.navigation.show(cap);
      this.entry = cap.kind === "markdown" ? "README.md" : undefined;
      this.mode = cap.kind === "database" ? "database" : cap.kind === "markdown" ? "content" : directoryKinds.has(cap.kind) ? "files" : "content";
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
    tab.append(icon(this.entry ? fileKind(this.entry) : cap.kind, `kind-${cap.kind}`), node("span", "", this.entry?.split("/").at(-1) || cap.name));
    if (this.hasDirty()) tab.append(node("span", "dirty-indicator", "●"));
    replace(document.getElementById("editor-tabs"), tab);
    const crumbs = [node("span", "", this.item?.path || cap.name)];
    if (this.entry) crumbs.push(node("span", "muted", "›"), node("span", "mono", this.entry));
    replace(document.getElementById("breadcrumbs"), ...crumbs);
    document.getElementById("status-context").textContent = `${kindLabels[cap.kind]} · ${shortCommit(cap.commit)}${this.hasDirty() ? " · 未保存" : ""}`;
    const actions = document.getElementById("content-actions");
    const controls = [];
    if (directoryKinds.has(cap.kind)) controls.push(button("文件概览", () => this.showFiles(), this.mode === "files" ? "button active ghost" : "button ghost"));
    if (cap.kind === "markdown") controls.push(button("正文", () => this.openFile("README.md"), this.entry === "README.md" && this.mode === "content" ? "button active ghost" : "button ghost"));
    if (cap.kind === "database") controls.push(button("数据", () => this.showDatabase(), this.mode === "database" ? "button active ghost" : "button ghost"));
    if (cap.kind === "code") {
      const run = button("运行", () => this.onRun(cap, this.hasDirty()), "button ghost");
      run.prepend(icon("play"));
      run.disabled = !cap.runtime;
      run.title = cap.runtime ? "同步服务端版本后本地运行" : "此 cap 尚未配置运行入口";
      controls.push(run);
    }
    const upload = button(cap.kind === "markdown" ? "上传附件" : "上传", () => this.onUpload(cap, this.entry), "button ghost");
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
    this.database?.destroy?.();
    this.database = null;
    if (this.mode === "history") {
      await historyView(this.content, cap, isCurrent, (target) => this.onRevert(this.cap, target, this.hasDirty()), this.onError);
      return;
    }
    if (this.mode === "database") {
      const { DatabaseView } = await import("./database.mjs");
      if (!isCurrent()) return;
      this.database = new DatabaseView(this.content, cap, {
        isCurrent,
        onError: this.onError,
        table: this.databaseTable,
        drafts: this.databaseDrafts,
        onDirty: () => this.chrome(),
        onTableSelected: (table) => { this.databaseTable = table; this.navigation?.selectTable(table); },
        onSaved: (saved) => this.saved(saved),
      });
      if (isCurrent()) this.displayedCommit = cap.commit;
      return;
    }
    if (this.mode === "files") {
      if (!background) replace(this.content, node("p", "loading", "正在读取文件…"));
      try {
        const page = await action("entries", { name: cap.name, limit: 100 });
        if (!isCurrent()) return;
        this.filePage = page;
        this.renderFiles(isCurrent);
        this.displayedCommit = cap.commit;
      } catch (error) { if (isCurrent()) this.showError(error); }
      return;
    }
    const kind = fileKind(entry || cap.name, entry ? "file" : cap.kind);
    if (["image", "audio", "video"].includes(kind)) {
      mediaView(this.content, cap, entry, (context) => { if (isCurrent()) this.inspector.context(context); });
      this.displayedCommit = cap.commit;
      return;
    }
    if (["excel", "word"].includes(kind)) {
      await officeView(this.content, cap, entry, isCurrent, this.onError, (context) => this.inspector.context(context), (saved) => {
        this.saved(saved);
        if (isCurrent()) this.refresh(true);
      });
      if (isCurrent()) this.displayedCommit = cap.commit;
      return;
    }
    if (kind === "file") {
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
      this.inspector.context({ label: /\.md$/i.test(entry || cap.name) ? "正文大纲" : "文件内容", headings: markdownOutline(record.body), values: [`${record.body.split("\n").length} 行 · ${record.body.length.toLocaleString()} 字符`], entry });
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
  openFile(entry) { this.entry = entry; this.mode = "content"; this.navigation?.selectEntry(entry); this.inspector.context({ label: "当前文件", values: [entry] }); this.chrome(); this.load(); }
  showFiles() { this.entry = undefined; this.mode = "files"; this.navigation?.setMode("files"); this.inspector.context({ label: "文件集合", values: ["从第二列目录进入文件。"] }); this.chrome(); this.load(); }
  showDatabase(table) { this.entry = undefined; this.databaseTable = table; this.mode = "database"; this.navigation?.setMode("tables"); this.navigation?.selectTable(table); this.inspector.context({ label: table ? "当前数据表" : "数据浏览", values: [table || "选择数据表浏览，或展开 SQL 自定义查询。"] }); this.chrome(); this.load(); }
  showHistory() { this.mode = "history"; this.inspector.context({ label: "版本历史", values: ["此 cap 的内容与元数据提交。回撤会通过队列生成新版本。"] }); this.chrome(); this.load(); }
  showError(error) {
    replace(this.content, node("p", "error-message file-empty", error.message));
    this.onError(error);
  }
  saved(cap, { reload = false } = {}) {
    this.onChanged();
    if (this.cap?.name !== cap.name) return;
    this.cap = cap;
    this.inspector.show(cap);
    this.navigation?.update(cap);
    if (this.mode === "database") this.database?.refresh(cap);
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
      this.navigation?.update(cap);
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
