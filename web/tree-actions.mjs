import { button } from "./dom.mjs";
import { icon } from "./icons.mjs";
import { ActionMenu } from "./menu.mjs";
import { canCreate, canEdit } from "./permissions.mjs";

export class TreeActions {
  constructor(element, { onManage, onError }) {
    this.onManage = onManage;
    this.menu = new ActionMenu(element, { manual: true, label: "知识节点操作", onError, getItems: () => this.items() });
  }
  items() {
    const item = this.current;
    return [
      { label: "属性", icon: "info", action: () => this.onManage("properties", item) },
      { label: "复制为新 cap…", disabled: !canCreate(), action: () => this.onManage("copy", item) },
      { separator: true },
      { label: "断开当前挂载…", disabled: !item.path || !canEdit(item), action: () => this.onManage("unlink", item) },
      { separator: true },
      { label: "清除整个 cap…", danger: true, disabled: !canEdit(item), action: () => this.onManage("delete", item) },
    ];
  }
  bind(row, item, mounted) {
    const properties = button("", (event) => {
      event.stopPropagation();
      Promise.resolve(this.onManage("properties", { ...item })).catch(this.menu.onError);
    }, "icon-button tree-actions tree-properties");
    properties.append(icon("info"));
    properties.title = `${item.name} · 属性`;
    properties.setAttribute("aria-label", properties.title);
    const more = button("", (event) => {
      event.stopPropagation();
      this.open(item, mounted, more);
    }, "icon-button tree-actions");
    more.append(icon("more"));
    more.title = `${item.name} · 节点操作`;
    more.setAttribute("aria-label", more.title);
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-controls", this.menu.element.id);
    more.setAttribute("aria-expanded", "false");
    more.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      this.open(item, mounted, more);
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.open(item, mounted, more, event.clientX, event.clientY);
    });
    row.append(properties, more);
  }
  open(item, mounted, anchor, x, y) {
    this.current = { ...item, path: mounted ? item.path : undefined };
    this.menu.open({ anchor, x, y });
  }
  close() { this.menu.close({ restoreFocus: false }); }
}
