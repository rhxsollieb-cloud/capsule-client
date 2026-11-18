import { action } from "./api.mjs";
import { button, directoryKinds, fileKind, node, replace, sizeLabel } from "./dom.mjs";
import { icon } from "./icons.mjs";
import { nativeTree, sortedChildren } from "./native-tree.mjs";
import { NativeDirectoryPages } from "./native-directory.mjs";

export class NativeNavigator {
  constructor({ onOpenEntry, onOpenTable, onError }) {
    Object.assign(this, { onOpenEntry, onOpenTable, onError });
    this.element = document.getElementById("native-navigation");
    this.workspace = document.querySelector(".workspace");
    this.request = 0;
    this.expanded = new Set();
    this.directories = new NativeDirectoryPages({ onChange: () => this.render(), onError });
    this.element.addEventListener("keydown", (event) => this.keyboard(event));
  }
  hide() {
    this.request++;
    this.cap = null;
    this.directories.reset();
    this.element.classList.add("hidden");
    this.workspace.classList.remove("has-native");
  }
  async show(cap) {
    if (!directoryKinds.has(cap.kind)) { this.hide(); return; }
    const changed = this.cap?.name !== cap.name;
    this.cap = cap;
    if (changed) {
      this.directories.reset();
      this.mode = cap.kind === "database" ? "tables" : "files";
      this.tables = [];
      this.nextOffset = undefined;
      this.error = undefined;
      this.busy = false;
      this.expanded.clear();
      this.selectedEntry = cap.kind === "markdown" ? "README.md" : undefined;
      this.selectedTable = undefined;
    }
    this.element.classList.remove("hidden");
    this.workspace.classList.add("has-native");
    await this.load();
  }
  async load(offset = 0) {
    if (!this.cap) return;
    if (this.mode === "files") {
      if (offset) return this.directories.load(this.cap.name, "", offset);
      this.directories.reset();
      const name = this.cap.name, pages = this.directories.pages;
      if (!await this.directories.load(name) || this.mode !== "files" || this.directories.legacy) return;
      const expanded = [...this.expanded].sort((a, b) => a.length - b.length);
      for (const directory of expanded) {
        if (this.directories.pages !== pages || this.mode !== "files") return;
        const parent = directory.slice(0, Math.max(0, directory.lastIndexOf("/")));
        if (this.directories.get(parent)?.items.some((item) => item.path === directory && item.kind === "directory"))
          await this.directories.load(name, directory);
      }
      return;
    }
    const cap = this.cap;
    const mode = this.mode;
    const request = ++this.request;
    this.busy = true;
    this.render();
    try {
      const result = await action("query", { name: cap.name, sql: "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", limit: 100, offset });
      if (request !== this.request || this.cap?.name !== cap.name || this.mode !== mode) return;
      this.tables = offset ? [...this.tables, ...result.items] : result.items;
      this.nextOffset = result.nextOffset;
      this.total = result.total;
      this.error = undefined;
    } catch (error) {
      if (request !== this.request) return;
      this.error = error.message;
      this.onError(error);
    } finally {
      if (request === this.request) { this.busy = false; this.render(); }
    }
  }
  update(cap) {
    if (this.cap?.name !== cap.name) return this.show(cap);
    const changed = this.cap.commit !== cap.commit;
    this.cap = cap;
    if (changed) this.load();
  }
  selectEntry(entry) {
    this.selectedEntry = entry;
    const changed = this.mode !== "files";
    this.mode = "files";
    const segments = entry?.split("/") || [];
    for (let index = 1; index < segments.length; index++) this.expanded.add(segments.slice(0, index).join("/"));
    if (changed) this.load();
    else {
      this.render();
      void this.revealEntryParents(entry, segments);
    }
  }
  async revealEntryParents(entry, segments) {
    const name = this.cap?.name, pages = this.directories.pages;
    if (!name || !this.directories.get()?.loaded || this.directories.legacy) return;
    for (let index = 1; index < segments.length; index++) {
      if (this.directories.pages !== pages || this.mode !== "files" || this.selectedEntry !== entry) return;
      const directory = segments.slice(0, index).join("/");
      if (!this.directories.get(directory)?.loaded && !await this.directories.load(name, directory)) return;
    }
  }
  selectTable(name) { this.selectedTable = name; this.render(); }
  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === "tables") this.directories.reset();
    this.nextOffset = undefined;
    this.error = undefined;
    this.load();
  }
  entryRow(item, depth) {
    const folder = item.kind === "directory" || Boolean(item.children?.size);
    const wrapper = node("div", "native-node");
    const row = button("", () => {
      if (folder) {
        if (this.expanded.has(item.path)) this.expanded.delete(item.path);
        else {
          this.expanded.add(item.path);
          if (!this.directories.legacy && !this.directories.get(item.path)) {
            void this.directories.load(this.cap.name, item.path);
            return;
          }
        }
        this.render();
      } else {
        this.selectEntry(item.path);
        this.onOpenEntry(item.path);
      }
    }, `native-entry${this.selectedEntry === item.path && !folder ? " selected" : ""}`);
    row.dataset.depth = String(Math.min(depth, 12));
    row.dataset.path = item.path;
    const size = item.file?.size ?? item.size;
    row.title = folder || size === undefined ? item.path : `${item.path} · ${sizeLabel(size)}`;
    if (folder) {
      row.setAttribute("aria-expanded", String(this.expanded.has(item.path)));
      row.append(icon("chevron", this.expanded.has(item.path) ? "native-chevron expanded" : "native-chevron"));
      row.addEventListener("keydown", (event) => {
        const open = this.expanded.has(item.path);
        if (event.key === "ArrowRight" && !open || event.key === "ArrowLeft" && open) {
          event.preventDefault();
          row.click();
        }
      });
    } else row.append(node("span", "native-chevron-space"));
    const kind = folder ? "files" : fileKind(item.name);
    row.append(icon(kind, `kind-${kind}`), node("span", "native-label", item.name));
    wrapper.append(row);
    if (folder && this.expanded.has(item.path)) {
      if (this.directories.legacy) {
        for (const child of sortedChildren(item)) wrapper.append(this.entryRow(child, depth + 1));
      } else this.renderDirectory(wrapper, item.path, depth + 1);
    }
    return wrapper;
  }
  renderDirectory(container, directory = "", depth = 0) {
    const page = this.directories.get(directory);
    if (!page) return;
    if (this.directories.legacy) {
      const entries = this.cap.kind === "markdown" && page.loaded && !page.items.some((item) => item.path === "README.md")
        ? [{ path: "README.md" }, ...page.items] : page.items;
      for (const item of sortedChildren(nativeTree(entries))) container.append(this.entryRow(item, depth));
    } else {
      // Scope order comes from the server; subsequent pages extend that order.
      for (const item of page.items) {
        const basename = item.path.split("/").at(-1);
        container.append(this.entryRow({ ...item, name: basename }, depth));
      }
    }
    if (page.busy) container.append(node("p", "tree-message", "正在读取…"));
    else if (page.error) {
      container.append(node("p", "tree-message error-message", page.error));
      container.append(button("重试", () => this.directories.load(this.cap.name, directory, page.failedOffset), "button ghost tree-more"));
    } else if (page.loaded && !page.items.length) container.append(node("p", "tree-message", "暂无内容"));
    if (page.nextOffset !== null && page.nextOffset !== undefined && !page.error) {
      const more = button("加载更多", () => {
        if (!this.directories.get(directory)?.busy) this.directories.load(this.cap.name, directory, page.nextOffset);
      }, "button ghost tree-more");
      more.dataset.path = `more:${directory}`;
      more.setAttribute("aria-label", directory ? `加载更多：${directory}` : "加载更多");
      more.setAttribute("aria-disabled", String(page.busy));
      container.append(more);
    }
  }
  keyboard(event) {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const rows = [...this.element.querySelectorAll(".native-entry")];
    const index = rows.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
  }
  render() {
    if (!this.cap) return;
    const focused = this.element.contains(document.activeElement) ? document.activeElement.dataset.path : undefined;
    const scope = `${this.cap.name}\0${this.mode}`;
    const scrollTop = this.renderedScope === scope ? this.element.querySelector?.(".native-scroll")?.scrollTop : 0;
    this.renderedScope = scope;
    const header = node("div", "sidebar-header native-header");
    header.append(icon(this.cap.kind, `kind-${this.cap.kind}`), node("h2", "", this.cap.name));
    const refresh = button("", () => this.load(), "icon-button");
    refresh.append(icon("refresh"));
    refresh.title = "刷新内部内容";
    refresh.setAttribute("aria-label", refresh.title);
    header.append(refresh);
    const children = [header];
    if (this.cap.kind === "database") {
      const tabs = node("div", "sidebar-tabs native-tabs");
      for (const [mode, label] of [["tables", "数据表"], ["files", "文件"]])
        tabs.append(button(label, () => this.setMode(mode), `tab-button${this.mode === mode ? " active" : ""}`));
      children.push(tabs);
    }
    const list = node("div", "native-scroll");
    if (this.mode === "tables") {
      if (this.error) list.append(node("p", "tree-message error-message", this.error));
      for (const table of this.tables || []) {
        const control = button("", () => { this.selectTable(table.name); this.onOpenTable(table.name); }, `native-entry${table.name === this.selectedTable ? " selected" : ""}`);
        control.dataset.path = `table:${table.name}`;
        control.append(icon("excel", "kind-database"), node("span", "native-label mono", table.name));
        list.append(control);
      }
      if (this.busy) list.append(node("p", "tree-message", "正在读取…"));
      else if (!this.tables?.length && !this.error) list.append(node("p", "tree-message", "暂无内容"));
      if (this.nextOffset !== null && this.nextOffset !== undefined) {
        const more = button("加载更多", () => this.load(this.nextOffset), "button ghost tree-more");
        more.disabled = this.busy;
        list.append(more);
      }
    } else this.renderDirectory(list);
    children.push(list);
    replace(this.element, ...children);
    if (scrollTop) list.scrollTop = scrollTop;
    if (focused) [...this.element.querySelectorAll("[data-path]")].find((element) => element.dataset.path === focused)?.focus({ preventScroll: true });
  }
}
