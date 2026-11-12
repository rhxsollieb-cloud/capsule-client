import { action } from "./api.mjs";
import { button, node, replace, shortCommit } from "./dom.mjs";

function cellValue(value) {
  if (value === null) return "NULL";
  if (value?.type === "bigint") return value.value;
  if (value?.type === "blob") return `[BLOB · ${Math.floor(value.base64.length * 3 / 4)} B]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export class DatabaseView {
  constructor(container, cap, { isCurrent, onError }) {
    Object.assign(this, { container, cap, isCurrent, onError });
    this.wrapper = node("div", "query-panel");
    this.input = node("textarea", "sql-editor");
    this.input.value = "SELECT name, type FROM sqlite_schema\nWHERE name NOT LIKE 'sqlite_%'\nORDER BY name";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "SQLite 查询语句");
    this.toolbar = node("div", "query-toolbar");
    this.note = node("span", "muted", "只读查询 · 每页 50 行");
    this.execute = button("执行查询", () => this.query(0), "button primary");
    this.toolbar.append(this.note, this.execute);
    this.results = node("div", "query-results");
    this.wrapper.append(this.input, this.toolbar, this.results);
    replace(container, this.wrapper);
    this.input.addEventListener("input", () => {
      this.note.textContent = this.input.value === this.lastSql ? `结果基于 ${shortCommit(this.resultCommit)}` : "查询语句已修改，执行后更新结果";
      if (this.next) this.next.disabled = this.input.value !== this.lastSql;
    });
    this.input.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        this.query(0);
      }
    });
    this.query(0);
  }
  async query(offset) {
    if (this.busy) return;
    const sql = this.input.value;
    if (!sql.trim()) return;
    this.busy = true;
    this.execute.disabled = true;
    this.note.textContent = "正在查询…";
    try {
      const result = await action("query", { name: this.cap.name, sql, limit: 50, offset });
      if (!this.isCurrent()) return;
      this.lastSql = sql;
      this.resultCommit = result.commit;
      this.note.textContent = `${result.items.length} 行 · ${shortCommit(result.commit)}`;
      this.render(result, offset);
    } catch (error) {
      if (this.isCurrent()) {
        this.note.textContent = "查询失败";
        replace(this.results, node("p", "error-message file-empty", error.message));
      }
      this.onError(error);
    } finally {
      this.busy = false;
      this.execute.disabled = false;
    }
  }
  render(result, offset) {
    const scroll = node("div", "table-scroll");
    const table = node("table", "data-table");
    const head = node("thead");
    const row = node("tr");
    for (const column of result.columns) row.append(node("th", "", column));
    head.append(row);
    const body = node("tbody");
    for (const item of result.items) {
      const tr = node("tr");
      for (const column of result.columns) {
        const value = cellValue(item[column]);
        const td = node("td", item[column] === null ? "muted" : "", value);
        td.title = value;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(head, body);
    scroll.append(table);
    const footer = node("div", "query-pagination");
    const previous = button("上一页", () => this.query(Math.max(0, offset - 50)));
    previous.disabled = offset === 0;
    this.next = button("下一页", () => this.query(result.nextOffset));
    this.next.disabled = result.nextOffset === null || result.nextOffset === undefined || this.input.value !== this.lastSql;
    footer.append(node("span", "muted", result.items.length ? `第 ${offset + 1}—${offset + result.items.length} 行` : "没有匹配结果"), previous, this.next);
    replace(this.results, scroll, footer);
  }
  refresh(cap) {
    this.cap = cap;
    if (this.input.value === this.lastSql) this.query(0);
    else this.note.textContent = "数据库已有新版本，执行查询后查看最新结果";
  }
}
