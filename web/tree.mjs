import { action } from "./api.mjs";
import { button, node, replace } from "./dom.mjs";
import { icon } from "./icons.mjs";

export class KnowledgeTree {
  constructor(element, { onSelect, onError, onEmpty }) {
    this.element = element;
    this.onSelect = onSelect;
    this.onError = onError;
    this.onEmpty = onEmpty;
    this.mode = "tree";
    this.query = "";
    this.expanded = new Map();
    this.selected = null;
    this.items = [];
    this.nextOffset = null;
    this.request = 0;
    document.querySelector("#mode-tree").addEventListener("click", () => this.setMode("tree"));
    document.querySelector("#mode-all").addEventListener("click", () => this.setMode("all"));
  }
  async setMode(mode) {
    this.mode = mode;
    if (mode === "tree") this.query = "";
    this.expanded.clear();
    await this.refresh();
  }
  async search(query) {
    this.query = query;
    this.mode = query ? "all" : "tree";
    this.expanded.clear();
    await this.refresh();
  }
  async refresh() {
    const request = ++this.request;
    this.renderLoading();
    try {
      const result = await this.fetchPage(0);
      if (request !== this.request) return;
      this.items = result.items;
      this.nextOffset = result.nextOffset;
      this.render();
      this.onEmpty?.(result.total === 0);
    } catch (error) {
      if (request !== this.request) return;
      replace(this.element, node("p", "tree-message error-message", error.message), button("重试", () => this.refresh(), "button ghost"));
      this.onError(error);
    }
  }
  fetchPage(offset) {
    return this.mode === "tree"
      ? action("ls", { path: "/", limit: 50, offset })
      : action("list", { query: this.query || undefined, limit: 50, offset });
  }
  async more() {
    const request = this.request;
    try {
      const result = await this.fetchPage(this.nextOffset);
      if (request !== this.request) return;
      this.items.push(...result.items);
      this.nextOffset = result.nextOffset;
      this.render();
    } catch (error) { this.onError(error); }
  }
  async toggle(item) {
    if (this.expanded.has(item.path)) {
      this.expanded.delete(item.path);
      this.render();
      return;
    }
    const request = this.request;
    this.expanded.set(item.path, { loading: true });
    this.render();
    try {
      const result = await action("ls", { path: item.path, limit: 50 });
      if (request !== this.request || !this.expanded.has(item.path)) return;
      this.expanded.set(item.path, result);
      this.render();
    } catch (error) {
      this.expanded.delete(item.path);
      this.render();
      this.onError(error);
    }
  }
  async moreChildren(item) {
    const previous = this.expanded.get(item.path);
    const request = this.request;
    try {
      const result = await action("ls", { path: item.path, limit: 50, offset: previous.nextOffset });
      if (request !== this.request || !this.expanded.has(item.path)) return;
      this.expanded.set(item.path, { ...result, items: [...previous.items, ...result.items] });
      this.render();
    } catch (error) { this.onError(error); }
  }
  choose(item) {
    this.selected = item;
    this.render();
    this.onSelect(item);
  }
  row(item, depth) {
    const container = node("div", "tree-node");
    const selected = this.selected?.name === item.name &&
      (this.mode === "all" || this.selected.path === item.path);
    const row = node("div", `tree-row${selected ? " selected" : ""}`);
    row.dataset.depth = String(Math.min(depth, 12));
    row.title = item.description || item.name;
    const toggle = button("", (event) => {
      event.stopPropagation();
      this.toggle(item);
    }, `tree-toggle${this.expanded.has(item.path) ? " expanded" : ""}`);
    toggle.append(icon("chevron"));
    toggle.disabled = !item.hasChildren || this.mode !== "tree";
    toggle.setAttribute("aria-label", this.expanded.has(item.path) ? "折叠" : "展开");
    toggle.setAttribute("aria-expanded", String(this.expanded.has(item.path)));
    const select = button("", () => this.choose(item), "tree-select");
    select.append(icon(item.kind, `node-icon kind-${item.kind}`), node("span", "node-label", item.name));
    row.append(toggle, select);
    container.append(row);
    const children = this.expanded.get(item.path);
    if (children?.loading) container.append(node("div", "tree-message muted", "正在加载…"));
    if (children?.items) {
      for (const child of children.items) container.append(this.row(child, depth + 1));
      if (children.nextOffset !== null && children.nextOffset !== undefined)
        container.append(button("加载更多", () => this.moreChildren(item), "button ghost tree-more"));
    }
    return container;
  }
  renderLoading() {
    replace(this.element, node("p", "tree-message muted", "正在读取目录…"));
    this.renderModes();
  }
  renderModes() {
    for (const [id, mode] of [["mode-tree", "tree"], ["mode-all", "all"]]) {
      const element = document.getElementById(id);
      element.classList.toggle("active", this.mode === mode);
      element.setAttribute("aria-selected", String(this.mode === mode));
    }
    document.getElementById("tree-caption").textContent = this.query ? `搜索 · ${this.query}` : this.mode === "tree" ? "按需展开内容" : "包含未挂载的 cap";
  }
  render() {
    this.renderModes();
    const list = node("div", "tree-list");
    if (!this.items.length) {
      list.append(node("p", "tree-message muted", this.query ? "没有找到匹配的 cap" : "当前视图没有内容"));
      if (this.mode === "tree") list.append(button("查看全部 cap", () => this.setMode("all"), "button ghost tree-more"));
    }
    for (const item of this.items) list.append(this.row(item, 0));
    if (this.nextOffset !== null && this.nextOffset !== undefined)
      list.append(button("加载更多", () => this.more(), "button ghost tree-more"));
    replace(this.element, list);
  }
}
