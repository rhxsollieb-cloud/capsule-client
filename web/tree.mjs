import { action } from "./api.mjs";
import { button, node, replace } from "./dom.mjs";
import { icon } from "./icons.mjs";
import { TreeActions } from "./tree-actions.mjs";

export class KnowledgeTree {
  constructor(element, { onSelect, onError, onEmpty, onViewChanged, onManage }) {
    this.element = element;
    this.onSelect = onSelect;
    this.onError = onError;
    this.onEmpty = onEmpty;
    this.onViewChanged = onViewChanged;
    this.mode = "tree";
    this.query = "";
    this.kind = "";
    this.expanded = new Map();
    this.selected = null;
    this.items = [];
    this.nextOffset = null;
    this.request = 0;
    if (onManage) this.actions = new TreeActions(element, { onManage, onError });
    this.element.addEventListener("keydown", (event) => this.keyboard(event));
  }
  async setMode(mode) {
    this.mode = mode;
    if (mode === "tree") this.kind = "";
    await this.refresh();
  }
  async setKind(kind) {
    this.kind = kind;
    this.mode = "all";
    await this.refresh();
  }
  isTreeView() { return this.mode === "tree" && !this.query && !this.kind; }
  async setFilter(value, { delay = 0 } = {}) {
    const query = value.trim();
    if (query === this.query) return;
    if (query && !this.query) {
      this.filterSnapshot = { expanded: new Map(this.expanded), items: this.items, nextOffset: this.nextOffset, selected: this.selected, scrollTop: this.element.scrollTop, selectionChanged: false };
    }
    if (!query && this.filterSnapshot) {
      this.expanded = this.filterSnapshot.expanded;
      this.items = this.filterSnapshot.items;
      this.nextOffset = this.filterSnapshot.nextOffset;
      if (!this.filterSnapshot.selectionChanged) this.selected = this.filterSnapshot.selected;
      this.restoreScroll = this.filterSnapshot.scrollTop;
      this.restorePages = { root: this.items.length, children: new Map([...this.expanded].map(([path, page]) => [path, page.items?.length || 0])) };
      this.filterSnapshot = null;
    } else { this.restoreScroll = undefined; this.restorePages = undefined; }
    this.query = query;
    this.request++;
    this.nextOffset = null;
    clearTimeout(this.filterTimer);
    this.renderLoading();
    if (delay) this.filterTimer = setTimeout(() => this.refresh(), delay);
    else await this.refresh();
  }
  async refresh() {
    clearTimeout(this.filterTimer);
    const request = ++this.request;
    const restorePages = this.restorePages;
    this.renderLoading();
    try {
      const result = await this.fetchRange((offset) => this.fetchPage(offset), restorePages?.root || 0, request);
      if (request !== this.request) return;
      this.items = result.items;
      this.nextOffset = result.nextOffset;
      const expandedPaths = this.isTreeView() ? [...this.expanded.keys()] : [];
      const children = await Promise.allSettled(expandedPaths.map((path) => this.fetchRange((offset) => action("ls", { path, limit: 50, offset }), restorePages?.children.get(path) || 0, request)));
      if (request !== this.request) return;
      children.forEach((child, index) => {
        const path = expandedPaths[index];
        if (!this.expanded.has(path)) return;
        if (child.status === "fulfilled") this.expanded.set(path, child.value);
        else this.expanded.delete(path);
      });
      this.render();
      if (this.restoreScroll !== undefined) { this.element.scrollTop = this.restoreScroll; this.restoreScroll = undefined; }
      if (this.restorePages === restorePages) this.restorePages = undefined;
      this.onEmpty?.(result.total === 0);
    } catch (error) {
      if (request !== this.request) return;
      replace(this.element, node("p", "tree-message error-message", error.message), button("重试", () => this.refresh(), "button ghost"));
      this.onError(error);
    }
  }
  fetchPage(offset) {
    return this.isTreeView()
      ? action("ls", { path: "/", limit: 50, offset })
      : action("list", { query: this.query || undefined, kind: this.kind || undefined, limit: 50, offset });
  }
  async fetchRange(fetchPage, count, request) {
    let result = await fetchPage(0);
    const items = [...result.items], offsets = new Set([0]);
    while (items.length < count && result.nextOffset !== null && result.nextOffset !== undefined && !offsets.has(result.nextOffset)) {
      if (request !== this.request) return result;
      offsets.add(result.nextOffset);
      result = await fetchPage(result.nextOffset);
      items.push(...result.items);
    }
    return { ...result, items };
  }
  async more() {
    const request = this.request;
    if (this.moreLoading === request || this.nextOffset === null || this.nextOffset === undefined) return;
    this.moreLoading = request;
    try {
      const result = await this.fetchPage(this.nextOffset);
      if (request !== this.request) return;
      this.items.push(...result.items);
      this.nextOffset = result.nextOffset;
      this.render();
    } catch (error) { if (request === this.request) this.onError(error); }
    finally { if (this.moreLoading === request) this.moreLoading = undefined; }
  }
  async toggle(item) {
    if (!this.isTreeView()) return;
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
      if (request !== this.request) return;
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
    } catch (error) { if (request === this.request) this.onError(error); }
  }
  choose(item) {
    if (this.filterSnapshot && item.name !== this.filterSnapshot.selected?.name) this.filterSnapshot.selectionChanged = true;
    this.selected = item;
    this.render();
    return this.onSelect(item);
  }
  async chooseFromOverview(item) {
    const visible = [...this.items, ...[...this.expanded.values()].flatMap((page) => page.items || [])].find((candidate) => candidate.name === item.name);
    if (visible) return this.choose(visible);
    else {
      await this.setMode("all");
      return this.choose(item);
    }
  }
  row(item, depth) {
    const treeView = this.isTreeView();
    const container = node("div", "tree-node");
    const selected = this.selected?.name === item.name &&
      (!treeView || this.selected.path === item.path);
    const row = node("div", `tree-row${selected ? " selected" : ""}`);
    row.dataset.depth = String(Math.min(depth, 12));
    row.dataset.path = item.path || item.name;
    row.title = item.description || item.name;
    const toggle = button("", (event) => {
      event.stopPropagation();
      this.toggle(item);
    }, `tree-toggle${this.expanded.has(item.path) ? " expanded" : ""}`);
    toggle.append(icon("chevron"));
    toggle.disabled = !item.hasChildren || !treeView;
    toggle.setAttribute("aria-label", this.expanded.has(item.path) ? "折叠" : "展开");
    toggle.setAttribute("aria-expanded", String(this.expanded.has(item.path)));
    const select = button("", () => this.choose(item), "tree-select");
    select.addEventListener("keydown", (event) => {
      if (!treeView) return;
      if (event.key === "ArrowRight" && item.hasChildren && !this.expanded.has(item.path)) { event.preventDefault(); this.toggle(item); }
      if (event.key === "ArrowLeft" && this.expanded.has(item.path)) { event.preventDefault(); this.toggle(item); }
    });
    select.append(icon(item.kind, `node-icon kind-${item.kind}`), node("span", "node-label", item.name));
    row.append(toggle, select);
    this.actions?.bind(row, item, treeView);
    container.append(row);
    const children = treeView && this.expanded.get(item.path);
    if (children?.loading) container.append(node("div", "tree-message muted", "正在加载…"));
    if (children?.items) {
      for (const child of children.items) container.append(this.row(child, depth + 1));
      if (children.nextOffset !== null && children.nextOffset !== undefined)
        container.append(button("加载更多", () => this.moreChildren(item), "button ghost tree-more"));
    }
    return container;
  }
  renderLoading() {
    this.actions?.close();
    replace(this.element, node("p", "tree-message muted", this.query ? "正在过滤…" : "正在读取目录…"));
    this.renderModes();
  }
  renderModes() {
    this.onViewChanged?.({ mode: this.mode, kind: this.kind, query: this.query });
  }
  keyboard(event) {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const rows = [...this.element.querySelectorAll(".tree-select")];
    const index = rows.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
  }
  render() {
    this.actions?.close();
    this.renderModes();
    const list = node("div", "tree-list");
    if (!this.items.length) {
      list.append(node("p", "tree-message muted", this.query ? "没有找到匹配的 cap" : "当前视图没有内容"));
      if (this.isTreeView()) list.append(button("查看全部 cap", () => this.setMode("all"), "button ghost tree-more"));
    }
    for (const item of this.items) list.append(this.row(item, 0));
    if (this.nextOffset !== null && this.nextOffset !== undefined)
      list.append(button("加载更多", () => this.more(), "button ghost tree-more"));
    replace(this.element, list);
  }
}
