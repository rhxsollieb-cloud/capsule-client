import { action, contentUrl, readDetails, readText } from "./api.mjs";
import { directoryKinds, fileKind, node, replace } from "./dom.mjs";
import { TextEditor } from "./editor.mjs";
import { emptyView, filesView, fileView, historyView, mediaView } from "./views.mjs";
import { OfficeView } from "./office.mjs";
import { isOfficeFile } from "./office-state.mjs";
import { overviewView } from "./overview.mjs";
import { markdownOutline } from "./markdown.mjs";
import { NativeNavigator } from "./native-navigation.mjs";
import { DocumentHeader } from "./document-header.mjs";
import { SkillView } from "./skill.mjs";
import { ActivitySession } from "./activity.mjs";

export class Workspace {
  constructor({ inspector, onError, onChanged, onCreate, onRun, onUpload, onRevert }) {
    Object.assign(this, { inspector, onError, onChanged, onCreate, onRun, onUpload, onRevert });
    this.content = document.getElementById("content");
    this.header = new DocumentHeader(document.getElementById("document-header"), { onError });
    this.activity = new ActivitySession({ onChange: (state) => this.header.activity.update(state) });
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
  hasDirty() { return Boolean(this.cap && (this.editor.hasDirty(this.cap.name, this.entry) || this.database?.hasDirty() || this.office?.hasDirty())); }
  draftState(name) {
    const drafts = [...this.editor.drafts, ...this.databaseDrafts].filter(([key]) => key.startsWith(`${name}\0`)).map(([, draft]) => draft);
    const description = this.inspector.drafts.get(name);
    if (description) drafts.push(description);
    const office = this.cap?.name === name ? this.office : null;
    return {
      dirty: drafts.some((draft) => draft.dirty) || Boolean(office?.hasDirty()),
      saving: drafts.some((draft) => draft.saving) || Boolean(office?.state.saving || office?.collecting),
    };
  }
  unlinked(item) {
    if (this.item?.path !== item.path || this.item?.name !== item.name) return;
    this.item = { ...this.item, path: undefined };
    if (this.cap) this.chrome();
    else this.header.update({ name: item.name, kind: item.kind, path: item.name, controls: { state: "loading", statusText: "读取中" }, contextKey: `loading-${this.selection}` });
  }
  removed(name) {
    for (const drafts of [this.editor.drafts, this.databaseDrafts])
      for (const key of drafts.keys()) if (key.startsWith(`${name}\0`)) drafts.delete(key);
    this.inspector.drafts.delete(name);
    if (this.inspector.selected?.name === name) this.inspector.selected = null;
    if (this.editor.current?.cap?.name === name) this.editor.current = null;
    if (this.inspector.current?.name === name) {
      this.inspector.current = null;
      this.inspector.draft = null;
      this.inspector.hide();
    }
    if (this.cap?.name !== name && this.item?.name !== name) return;
    this.selection++;
    this.viewRequest++;
    this.office?.destroy();
    this.office = null;
    this.database?.destroy?.();
    this.database = null;
    this.skillView?.destroy();
    this.skillView = null;
    this.cap = null;
    this.item = null;
    this.entry = undefined;
    this.detailsMode = false;
    this.displayedCommit = undefined;
    this.navigation.hide();
    this.activity?.clear();
    this.header.update(null);
    emptyView(this.content, this.onCreate);
  }
  async leaveOffice() {
    const office = this.office;
    if (office && !await office.prepareLeave()) return false;
    if (this.office === office) { office?.destroy(); this.office = null; }
    return true;
  }
  async select(item) {
    if (!await this.leaveOffice()) return false;
    const selected = ++this.selection;
    this.item = item;
    this.database?.destroy?.();
    this.database = null;
    this.cap = null;
    this.entry = undefined;
    this.detailsMode = false;
    this.activity?.clear();
    this.editingContent = false;
    this.header.update({ name: item.name, kind: item.kind, path: item.path, controls: { state: "loading", statusText: "读取中" }, contextKey: `loading-${selected}` });
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
      this.mode = cap.kind === "code" ? "skill" : cap.kind === "database" ? "database" : cap.kind === "markdown" ? "content" : directoryKinds.has(cap.kind) ? "files" : "content";
      this.chrome();
      await this.load();
    } catch (error) {
      if (selected === this.selection) {
        replace(this.content, node("p", "error-message file-empty", error.message));
        this.header.update({ name: item.name, kind: item.kind, path: this.item?.path || item.name, controls: { state: "error", statusText: "读取失败", detail: error.message }, contextKey: `failed-${selected}` });
      }
      this.onError(error);
    }
  }
  chrome() {
    if (!this.cap) return;
    const cap = this.cap;
    const entry = this.entry;
    const selection = this.selection;
    const mode = this.mode;
    const current = () => selection === this.selection && this.cap?.name === cap.name && this.entry === entry && this.mode === mode;
    const inContext = (callback) => () => { if (current()) return callback(); };
    let controls = null;
    if (this.mode === "skill") controls = this.skillView?.controlsInfo() || { state: "loading", statusText: "读取本机状态" };
    else if (this.mode === "content") controls = this.office?.controlsInfo() || this.editor.controls(cap.name, entry);
    if (!controls && this.database?.hasDirty()) controls = { state: "dirty", statusText: "表格有未保存修改" };
    this.updateActivity();
    const items = [];
    if (directoryKinds.has(cap.kind)) items.push({ label: "文件概览", icon: "files", action: inContext(() => this.showFiles()) });
    if (cap.kind === "markdown") items.push({ label: "打开正文", icon: "text", action: inContext(() => this.openFile("README.md")) });
    if (cap.kind === "database") items.push({ label: "浏览数据表", icon: "database", action: inContext(() => this.showDatabase()) });
    if (cap.kind === "code" && this.mode !== "skill") items.push(
      { label: "Skill 交互入口", icon: "code", action: inContext(() => this.showSkill()) },
      { label: "运行 Skill CLI", icon: "play", action: inContext(() => this.onRun(cap, this.hasDirty())) },
    );
    items.push(
      { label: cap.kind === "markdown" ? "上传附件" : "上传原件", icon: "upload", disabled: Boolean(this.office?.hasDirty()), action: inContext(() => this.onUpload(cap, entry)) },
      { label: "版本历史与回撤", icon: "history", disabled: Boolean(this.office?.state.saving), action: inContext(() => this.showHistory()) },
      { label: "检查更新", icon: "refresh", action: inContext(() => this.refresh(true)) },
    );
    if (!directoryKinds.has(cap.kind) || entry) items.push({
      label: "下载原件", icon: "download", href: contentUrl(cap.name, entry, true), download: entry?.split("/").at(-1) || cap.name,
    });
    this.header.update({
      cap, controls, items, activity: this.activity?.state,
      name: entry?.split("/").at(-1) || cap.name,
      kind: entry ? fileKind(entry) : cap.kind,
      path: [this.item?.path || cap.name, entry].filter(Boolean).join(" / "),
      contextKey: `${cap.name}\0${entry || ""}\0${this.mode}\0${this.detailsMode ? "details" : ""}`,
    });
  }
  updateActivity() {
    if (!this.activity || !this.cap) return;
    let scope;
    let entry;
    let dirty = false;
    if (this.mode === "content" && this.office) { scope = "office"; entry = this.entry; dirty = this.office.hasDirty(); }
    else if (this.mode === "content" && this.editingContent?.name === this.cap.name &&
        this.editingContent.entry === this.entry && this.editingContent.details === this.detailsMode) {
      scope = this.detailsMode ? "details" : "content";
      entry = scope === "content" ? this.entry : undefined;
      dirty = this.editor.hasDirty(this.cap.name, this.entry);
    } else if (this.mode === "database" && this.database?.record?.editable) { scope = "database"; dirty = this.database.hasDirty(); }
    this.activity.setTarget({ name: this.cap.name, scope, entry, dirty });
  }
  async load({ background = false } = {}) {
    if (!this.cap) return;
    if (this.mode === "skill" && this.skillView && background) { this.skillView.refresh(this.cap); return; }
    const selected = this.selection;
    const request = ++this.viewRequest;
    const cap = this.cap;
    const entry = this.entry;
    const isCurrent = () => selected === this.selection && request === this.viewRequest;
    if (this.office) {
      if (background) { this.office.refresh(cap); return; }
      if (!await this.leaveOffice() || !isCurrent()) return;
    }
    this.skillView?.destroy();
    this.skillView = null;
    this.database?.destroy?.();
    this.database = null;
    if (!background) this.editingContent = false;
    this.updateActivity();
    if (this.mode === "skill") {
      this.skillView = new SkillView(this.content, cap, {
        isCurrent, onError: this.onError,
        onRun: (current) => this.onRun(current, this.hasDirty()),
        onOpenEntry: (value) => this.openFile(value), onSaved: (saved) => this.saved(saved),
        onControlsChanged: () => { if (isCurrent()) this.chrome(); },
      });
      this.displayedCommit = cap.commit;
      this.chrome();
      return;
    }
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
    if (isOfficeFile(entry || cap.name)) {
      this.office = new OfficeView(this.content, cap, entry, {
        isCurrent,
        onError: this.onError,
        onSaved: (saved) => this.saved(saved),
        onDirty: () => this.chrome(),
        onReload: () => this.reopenOffice(),
      });
      if (isCurrent()) { this.displayedCommit = cap.commit; this.chrome(); }
      return;
    }
    if (["file", "word", "excel"].includes(kind)) {
      fileView(this.content, cap, entry);
      this.displayedCommit = cap.commit;
      return;
    }
    if (!background) replace(this.content, node("p", "loading", "正在读取正文…"));
    try {
      const record = this.detailsMode ? await readDetails(cap.name, isCurrent) : await readText(cap.name, entry, isCurrent);
      if (!record || !isCurrent()) return;
      if (background && this.editor.hasDirty(cap.name, entry)) {
        this.editor.markRemote(cap.name, entry);
        return;
      }
      this.cap = { ...this.cap, description: record.description ?? this.cap.description, runtime: record.runtime, commit: record.commit, token: record.token };
      this.editor.open(this.content, this.cap, entry, { ...record, saveAction: this.detailsMode ? "save-details" : "save" });
      this.editingContent = { name: cap.name, entry, details: this.detailsMode };
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
  async openDetails(record) {
    if (this.cap?.name !== record.name || record.source.type !== "content" || !await this.leaveOffice()) return;
    this.entry = record.kind === "text" ? undefined : record.source.entry;
    this.detailsMode = true;
    this.mode = "content";
    if (this.entry) this.navigation?.selectEntry(this.entry);
    this.chrome();
    await this.load();
  }
  async showSkill() { if (!await this.leaveOffice()) return; this.detailsMode = false; this.entry = undefined; this.mode = "skill"; this.chrome(); await this.load(); }
  async openFile(entry) { if (!await this.leaveOffice()) return; this.detailsMode = entry === "说明.md" && ["files", "code", "database"].includes(this.cap?.kind); this.entry = entry; this.mode = "content"; this.navigation?.selectEntry(entry); this.inspector.context({ label: "当前文件", values: [entry] }); this.chrome(); this.load(); }
  async showFiles() { if (!await this.leaveOffice()) return; this.detailsMode = false; this.entry = undefined; this.mode = "files"; this.navigation?.setMode("files"); this.inspector.context({ label: "文件集合", values: ["从第二列目录进入文件。"] }); this.chrome(); this.load(); }
  async showDatabase(table) { if (!await this.leaveOffice()) return; this.detailsMode = false; this.entry = undefined; this.databaseTable = table; this.mode = "database"; this.navigation?.setMode("tables"); this.navigation?.selectTable(table); this.inspector.context({ label: table ? "当前数据表" : "数据浏览", values: [table || "选择数据表浏览，或展开 SQL 自定义查询。"] }); this.chrome(); this.load(); }
  async showHistory() { if (!await this.leaveOffice()) return; this.mode = "history"; this.inspector.context({ label: "版本历史", values: ["此 cap 的内容与元数据提交。回撤会通过队列生成新版本。"] }); this.chrome(); this.load(); }
  async reopenOffice() {
    if (!await this.leaveOffice()) return;
    const selected = this.selection;
    try {
      const cap = await action("stat", { name: this.cap.name });
      if (selected !== this.selection) return;
      this.cap = cap;
      this.inspector.show(cap);
      this.chrome();
      await this.load();
    } catch (error) { this.onError(error); }
  }
  showError(error) {
    replace(this.content, node("p", "error-message file-empty", error.message));
    this.onError(error);
  }
  saved(cap, { reload = false } = {}) {
    this.onChanged();
    if (this.cap?.name !== cap.name) return;
    const draft = this.editor.drafts.get(this.editor.key(cap.name, this.entry));
    if (draft?.dirty && draft.baseToken !== cap.token) this.editor.markRemote(cap.name, this.entry);
    this.cap = cap;
    this.inspector.show(cap);
    this.navigation?.update(cap);
    this.office?.refresh(cap);
    this.skillView?.refresh(cap);
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
      if (this.office) { this.office.refresh(cap); return; }
      if (this.mode === "skill" && this.skillView) { this.skillView.refresh(cap); return; }
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
