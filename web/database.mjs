import { action } from "./api.mjs";
import { button, node, replace, shortCommit } from "./dom.mjs";
import { createDataGrid } from "./data-grid.mjs";
import { createDraft, draftKey, editCell, editableCell } from "./database-drafts.mjs";
import { saveErrorPresentation, saveErrorRecord } from "./save-errors.mjs";

export class DatabaseView {
  constructor(container, cap, { isCurrent, onError, table, drafts = new Map(), onDirty, onSaved, onTableSelected }) {
    Object.assign(this, { container, cap, isCurrent, onError, drafts, onDirty, onSaved, onTableSelected });
    this.wrapper = node("div", "query-panel");
    this.title = node("span", "database-table-title", "读取数据表…");
    this.note = node("span", "database-note");
    this.save = button("保存修改", () => this.saveChanges(), "button primary");
    this.discard = button("放弃当前表修改", () => this.discardChanges(), "button ghost");
    this.toolbar = node("div", "query-toolbar");
    this.toolbar.append(this.title, this.note, this.discard, this.save);
    this.input = node("textarea", "sql-editor");
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "SQLite只读查询");
    this.execute = button("执行查询", () => this.query(0), "button secondary");
    const sql = node("details", "sql-disclosure");
    sql.append(node("summary", "", "SQL只读查询"), this.input, this.execute);
    this.results = node("div", "query-results database-results");
    this.toolbar.title = "双击业务表单元格编辑，点击保存统一提交。排序和筛选作用于当前页。";
    this.wrapper.append(this.toolbar, sql, this.results);
    replace(container, this.wrapper);
    this.input.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); this.query(0); }
    });
    this.loadTable(table);
  }
  hasDirty() { return Boolean(this.draft?.dirty); }
  destroy() { this.grid?.destroy(); this.grid = null; }
  finishRequest() {
    this.busy = false;
    if (!this.isCurrent()) return;
    this.controls();
    this.onDirty?.();
    const pending = this.pendingRefresh;
    this.pendingRefresh = null;
    if (pending && pending.commit !== this.record?.commit) this.refresh(pending);
  }
  controls() {
    this.save.disabled = this.busy || this.draft?.saving || !this.hasDirty();
    this.discard.disabled = this.busy || this.draft?.saving || !this.hasDirty();
    this.execute.disabled = Boolean(this.busy);
    this.note.textContent = this.hasDirty()
      ? `${this.draft.saving ? "正在保存" : `${this.draft.changes.size} 行未保存`} · 基于 ${shortCommit(this.draft.record.commit)}${this.remote ? " · 服务端已有新版本" : ""}`
      : this.record ? `${shortCommit(this.record.commit)} · ${this.record.editable ? "可编辑" : "只读"}` : "";
    if (this.hasDirty() && !this.draft.saving && (this.draft.error || this.remote))
      this.note.textContent += ` · ${saveErrorPresentation(this.draft.error, { remote: this.remote }).message}`;
  }
  async loadTable(table, offset = 0) {
    if (this.busy) return;
    this.busy = true;
    this.controls();
    try {
      const record = await action("table", { name: this.cap.name, table, limit: 50, offset });
      if (!this.isCurrent()) return;
      this.record = record;
      this.mode = "table";
      this.table = record.table;
      this.offset = offset;
      this.onTableSelected?.(record.table);
      this.title.textContent = record.table || "暂无数据表";
      this.input.value = record.table ? `SELECT * FROM "${record.table.replaceAll('"', '""')}"` : "SELECT name FROM sqlite_schema";
      const key = draftKey(this.cap.name, record.table);
      const previous = this.drafts.get(key);
      this.draft = previous?.dirty ? previous : createDraft(record, offset);
      this.offset = this.draft.offset;
      this.drafts.set(key, this.draft);
      this.remote = this.draft.record.token !== record.token;
      this.render(this.draft.record, this.draft.rows, Boolean(record.table));
      const draft = this.draft;
      if (draft.saving) draft.completion.then(() => {
        if (!this.isCurrent() || this.draft !== draft) return;
        this.controls();
        if (!draft.dirty) this.loadTable(this.table, this.offset);
      });
    } catch (error) { if (this.isCurrent()) this.fail(error); }
    finally { this.finishRequest(); }
  }
  render(record, rows, editing = false) {
    this.destroy();
    const host = node("div", "database-grid");
    const footer = node("div", "query-pagination");
    const previous = button("上一页", () => editing ? this.page(Math.max(0, this.offset - 50)) : this.query(Math.max(0, this.offset - 50)));
    previous.disabled = this.offset === 0;
    const next = button("下一页", () => editing ? this.page(record.nextOffset) : this.query(record.nextOffset));
    next.disabled = record.nextOffset === null || record.nextOffset === undefined;
    footer.append(node("span", "", `${rows.length} 行 · 每页50行`), previous, next);
    replace(this.results, host, footer);
    this.grid = createDataGrid(host, {
      columns: record.columns,
      rows,
      editable: (index, name) => !this.busy && editing && editableCell(this.draft, index, name),
      onEdit: editing ? (index, name, value) => {
        editCell(this.draft, index, name, value);
        this.controls();
        this.onDirty?.();
        return Object.hasOwn(this.draft.changes.get(index)?.values || {}, name);
      } : undefined,
    });
  }
  page(offset) {
    if (this.hasDirty()) { this.note.textContent = "当前页有未保存修改，请先保存或放弃后翻页。"; return; }
    this.loadTable(this.table, offset);
  }
  async query(offset) {
    if (this.busy) return;
    if (this.hasDirty()) { this.note.textContent = "当前表有未保存修改，请先保存或放弃后查询。"; return; }
    this.busy = true;
    this.controls();
    const sql = this.input.value;
    if (offset && sql !== this.lastSql) offset = 0;
    try {
      const result = await action("query", { name: this.cap.name, sql, limit: 50, offset });
      if (!this.isCurrent()) return;
      this.record = { ...result, editable: false };
      this.mode = "query";
      this.lastSql = sql;
      this.offset = offset;
      this.title.textContent = "SQL查询结果";
      this.render(result, result.items);
    } catch (error) { if (this.isCurrent()) this.fail(error); }
    finally { this.finishRequest(); }
  }
  async saveChanges() {
    if (this.busy || this.draft?.saving || !this.hasDirty()) return;
    this.busy = true;
    const draft = this.draft;
    draft.saving = true;
    draft.error = undefined;
    this.controls();
    let reload = false;
    let finished;
    draft.completion = new Promise((resolve) => { finished = resolve; });
    try {
      const saved = await action("table-write", { name: this.cap.name, table: draft.record.table, changes: [...draft.changes.values()], token: draft.record.token });
      draft.dirty = false;
      draft.changes.clear();
      this.drafts.delete(draftKey(this.cap.name, draft.record.table));
      this.onSaved?.(saved);
      this.onDirty?.();
      if (!this.isCurrent()) return;
      this.cap = saved;
      reload = true;
    } catch (error) {
      draft.error = saveErrorRecord(error);
      this.onError(error);
    } finally {
      draft.saving = false;
      finished();
      this.finishRequest();
    }
    if (reload && this.isCurrent() && !this.busy) await this.loadTable(this.table, this.offset);
  }
  discardChanges() {
    if (this.busy || this.draft?.saving || !this.draft) return;
    this.drafts.delete(draftKey(this.cap.name, this.draft.record.table));
    this.draft = null;
    this.onDirty?.();
    this.loadTable(this.table, this.offset);
  }
  refresh(cap) {
    this.cap = cap;
    if (this.busy) { this.pendingRefresh = cap; return; }
    if (this.hasDirty()) { this.remote = cap.token !== this.draft.record.token; this.controls(); }
    else if (this.mode === "query") {
      if (this.input.value === this.lastSql) this.query(0);
      else this.note.textContent = "数据库已有新版本，执行查询后查看最新结果。";
    } else this.loadTable(this.table, this.offset);
  }
  fail(error) { this.note.textContent = error.message; this.onError(error); }
}
