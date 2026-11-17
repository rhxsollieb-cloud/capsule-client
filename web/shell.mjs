import { button, kindLabels, node } from "./dom.mjs";
import { ActionMenu } from "./menu.mjs";
import { NavigationResize } from "./navigation-resize.mjs";

export class LibraryShell {
  constructor({ tree, panel, dialogs, theme, onCreate, onReconnect, onConnection, onAdmin, onError }) {
    Object.assign(this, { tree, panel, dialogs, theme, onReconnect, onConnection, onAdmin });
    this.menuButton = document.getElementById("library-menu");
    this.connection = document.getElementById("connection");
    this.badge = document.getElementById("event-badge");
    this.filter = document.getElementById("library-filter");
    this.workspace = document.querySelector(".workspace");
    this.navigation = document.getElementById("knowledge-navigation");
    this.nativeNavigation = document.getElementById("native-navigation");
    this.libraryToggle = document.getElementById("toggle-library");
    this.menu = new ActionMenu(this.menuButton, { label: "知识库与工作台菜单", getItems: () => this.items(), onError });
    this.resize = new NavigationResize({ workspace: this.workspace, library: this.navigation, nativeNavigation: this.nativeNavigation });
    document.getElementById("new-cap").addEventListener("click", onCreate);
    this.filter.addEventListener("compositionstart", () => { this.composing = true; });
    this.filter.addEventListener("compositionend", () => { this.composing = false; tree.setFilter(this.filter.value, { delay: 180 }); });
    this.filter.addEventListener("input", (event) => { if (!event.isComposing && !this.composing) tree.setFilter(this.filter.value, { delay: 180 }); });
    this.filter.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape" && this.filter.value) { event.preventDefault(); this.filter.value = ""; tree.setFilter(""); }
      if (event.key === "ArrowDown") { const first = this.tree.element.querySelector(".tree-select"); if (first) { event.preventDefault(); first.focus(); } }
    });
    this.libraryToggle.addEventListener("click", () => this.setCollapsed(!this.collapsed));
    this.connection.addEventListener("click", onReconnect);
    document.addEventListener("keydown", (event) => this.keydown(event));
    let collapsed = false;
    try { collapsed = localStorage.getItem("capsule-library-collapsed") === "true"; } catch { /* Layout works without storage. */ }
    this.setCollapsed(collapsed, { persist: false });
    this.updateView();
  }
  keydown(event) {
    if (event.defaultPrevented || event.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
      if (event.repeat || event.altKey || event.shiftKey || event.target.closest?.("input, textarea, select, [contenteditable], dialog, [role=menu]")) return;
      event.preventDefault();
      this.setCollapsed(!this.collapsed);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      if (event.target.closest?.("dialog, [role=menu]")) return;
      event.preventDefault();
      this.focusFilter();
    }
  }
  setCollapsed(collapsed, { persist = true } = {}) {
    this.collapsed = collapsed;
    this.menu.close({ restoreFocus: false });
    const movingFocus = collapsed && (this.navigation.contains(document.activeElement) || this.nativeNavigation.contains(document.activeElement) || document.activeElement?.classList?.contains("navigation-resizer"));
    this.workspace.classList.toggle("library-collapsed", collapsed);
    this.navigation.inert = collapsed;
    this.nativeNavigation.inert = collapsed;
    this.libraryToggle.setAttribute("aria-expanded", String(!collapsed));
    this.libraryToggle.setAttribute("aria-label", collapsed ? "展开知识库" : "收起知识库");
    this.libraryToggle.title = `${collapsed ? "展开" : "收起"}知识库（⌘ / Ctrl + B）`;
    if (movingFocus) this.libraryToggle.focus();
    if (persist) {
      try { localStorage.setItem("capsule-library-collapsed", String(collapsed)); } catch { /* Layout works without storage. */ }
    }
  }
  updateView() {
    const title = this.tree.kind ? kindLabels[this.tree.kind] : this.tree.mode === "all" ? "全部 cap" : "知识库";
    this.filter.placeholder = `过滤${title}`;
    this.filter.setAttribute("aria-label", `过滤${title}名称或简介`);
    this.filter.title = `${title} · 按名称或简介过滤 · ⌘K / Ctrl+K`;
    if (!this.composing && this.filter.value.trim() !== this.tree.query) this.filter.value = this.tree.query;
  }
  focusFilter() {
    if (this.collapsed) this.setCollapsed(false);
    this.filter.focus();
    this.filter.select();
  }
  views() {
    return [
      { label: "按虚拟路径浏览", icon: "branch", checked: this.tree.mode === "tree", action: () => this.tree.setMode("tree") },
      { label: "全部 cap", icon: "library", checked: this.tree.mode === "all" && !this.tree.kind, action: () => this.tree.setKind("") },
      { separator: true },
      ...Object.entries(kindLabels).map(([kind, label]) => ({ label, icon: kind, checked: this.tree.mode === "all" && this.tree.kind === kind, action: () => this.tree.setKind(kind) })),
    ];
  }
  items() {
    return [
      ...this.views(),
      { separator: true },
      { label: "过滤当前列表", icon: "search", shortcut: "⌘ / Ctrl K", action: () => this.focusFilter() },
      { label: "收起知识库", icon: "library", shortcut: "⌘ / Ctrl B", action: () => this.setCollapsed(true) },
      { label: `事件与运行${this.attention ? ` · ${this.attention} 项需关注` : ""}`, icon: "events", checked: !this.panel.element.classList.contains("hidden"), action: () => this.panel.element.classList.contains("hidden") ? this.panel.open() : this.panel.close() },
      { label: "Agent 操作入口", icon: "terminal", action: () => this.dialogs.agent() },
      { separator: true },
      { label: "刷新知识库", icon: "refresh", action: () => this.tree.refresh() },
      { label: "连接与登录", action: () => this.onConnection ? this.onConnection() : this.connectionInfo() },
      { label: "账户与管理", icon: "info", action: () => this.onAdmin?.() },
      { label: "深色模式", checked: this.theme.isDark(), action: () => this.theme.toggle() },
      { label: "使用说明", action: () => this.help() },
    ];
  }
  setIdentity(identity) {
    this.identity = identity;
    const create = document.getElementById("new-cap");
    if (create) { create.hidden = !identity?.permissions?.create; create.disabled = !identity?.permissions?.create; }
  }
  setAttention(count) {
    this.attention = count;
    this.badge.textContent = count > 9 ? "9+" : String(count);
    this.badge.classList.toggle("hidden", !count);
    const label = `知识库与工作台菜单${count ? ` · ${count} 项事件需关注` : ""}`;
    this.menuButton.setAttribute("aria-label", label);
    this.menuButton.title = label;
  }
  setConnection(connected, message, serverUrl) {
    this.connected = connected;
    this.connectionMessage = message;
    if (serverUrl) this.serverUrl = serverUrl;
    const failed = !connected && message !== "连接中";
    this.connection.classList.toggle("hidden", !failed);
    this.connection.textContent = failed ? "连接异常 · 重试" : "";
    this.connection.title = message;
  }
  modal(title, paragraphs, retry = false) {
    const dialog = node("dialog", "shell-dialog");
    const body = node("div", "shell-dialog-content");
    body.append(node("h2", "", title));
    for (const text of paragraphs) body.append(node("p", "", text));
    const actions = node("div", "shell-dialog-actions");
    if (retry) actions.append(button("重新检测连接", () => { dialog.close(); this.onReconnect(); }));
    actions.append(button("关闭", () => dialog.close(), "button primary"));
    body.append(actions);
    dialog.append(body);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }
  connectionInfo() {
    this.modal("连接信息", [this.connectionMessage || "尚未连接", this.serverUrl || "服务端地址尚未取得"], true);
  }
  help() {
    this.modal("工作台操作", [
      "顶部输入框直接过滤知识列表，可同时选择内容类别。⌘K / Ctrl+K 聚焦过滤，↓ 进入结果，Esc 清空并恢复原树展开状态；清空不会切换正在打开的内容。",
      "点击左上角胶囊图标切换虚拟路径、全部 cap 和类别，或访问工作台菜单。文件操作位于内容标题右侧的菜单，也可右键标题。拖动两列右边界可调整宽度，边界聚焦后用左右方向键调整。",
      "内容标题左侧的知识库按钮或 ⌘B / Ctrl+B 可收起和展开知识库，目录内容列随之收起，原有展开状态会保留。输入框、菜单和对话框内保留各自快捷键。",
      "保存状态随内容显示：未保存、保存中和冲突会明确提示。只有知识库确认提交后才表示已保存。",
      "事件、运行结果、Agent 入口和主题设置在知识库菜单中。节点旁的属性按钮提供名称、简述与详述，媒体可按需浏览。",
    ]);
  }
}
