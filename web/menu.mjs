import { button, node } from "./dom.mjs";
import { icon } from "./icons.mjs";

export class ActionMenu {
  constructor(trigger, { getItems, label = "更多操作", manual = false, onError = (error) => console.error(error) }) {
    Object.assign(this, { trigger, getItems, onError });
    this.element = node("div", "action-menu hidden");
    this.element.id = `menu-${crypto.randomUUID()}`;
    this.element.setAttribute("role", "menu");
    this.element.setAttribute("aria-label", label);
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", this.element.id);
    this.click = (event) => { event.preventDefault(); this.opened ? this.close() : this.open(); };
    this.triggerKey = (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      this.open();
      if (event.key === "ArrowUp") this.items().at(-1)?.focus();
    };
    this.outside = (event) => {
      if (!this.element.contains(event.target) && !(this.anchor || trigger).contains(event.target)) this.close({ restoreFocus: false });
    };
    this.keyboard = (event) => this.keydown(event);
    this.blur = () => this.close({ restoreFocus: false });
    if (!manual) {
      trigger.addEventListener("click", this.click);
      trigger.addEventListener("keydown", this.triggerKey);
    }
    document.body.append(this.element);
  }
  items() { return [...this.element.querySelectorAll('[role^="menuitem"]')].filter((item) => !item.disabled); }
  open({ x, y, anchor = this.trigger } = {}) {
    this.close({ restoreFocus: false });
    this.anchor = anchor;
    this.element.replaceChildren();
    const items = this.getItems().filter((value) => value && !value.hidden);
    const visible = items.filter((item, index) => !item.separator || (index > 0 && !items[index - 1].separator && items.slice(index + 1).some((next) => !next.separator)));
    for (const item of visible) {
      if (item.separator) {
        const separator = node("div", "menu-separator");
        separator.setAttribute("role", "separator");
        this.element.append(separator);
        continue;
      }
      const control = item.href ? node("a", "menu-item") : button("", null, "menu-item");
      control.classList.toggle("danger", Boolean(item.danger));
      control.setAttribute("role", item.checked === undefined ? "menuitem" : "menuitemcheckbox");
      control.tabIndex = -1;
      if (item.checked !== undefined) control.setAttribute("aria-checked", String(item.checked));
      if (item.icon) control.append(icon(item.icon));
      else control.append(node("span", "menu-icon-space", item.checked ? "✓" : ""));
      control.append(node("span", "menu-item-label", item.label));
      if (item.shortcut) control.append(node("kbd", "", item.shortcut));
      if (item.href) {
        control.href = item.href;
        if (item.download !== undefined) control.download = item.download;
      }
      control.disabled = Boolean(item.disabled);
      control.setAttribute("aria-disabled", String(Boolean(item.disabled)));
      control.addEventListener("click", (event) => {
        if (item.disabled) { event.preventDefault(); return; }
        this.close();
        if (item.action) {
          event.preventDefault();
          try { Promise.resolve(item.action(event)).catch(this.onError); }
          catch (error) { this.onError(error); }
        }
      });
      this.element.append(control);
    }
    this.opened = true;
    this.element.classList.remove("hidden");
    anchor.setAttribute("aria-expanded", "true");
    const bounds = anchor.getBoundingClientRect();
    const width = this.element.getBoundingClientRect().width;
    const height = this.element.getBoundingClientRect().height;
    this.element.style.left = `${Math.max(8, Math.min(x ?? bounds.left, window.innerWidth - width - 8))}px`;
    this.element.style.top = `${Math.max(8, Math.min(y ?? bounds.bottom + 4, window.innerHeight - height - 8))}px`;
    document.addEventListener("pointerdown", this.outside, true);
    document.addEventListener("focusin", this.outside);
    window.addEventListener("blur", this.blur);
    this.element.addEventListener("keydown", this.keyboard);
    this.items()[0]?.focus();
  }
  keydown(event) {
    const controls = this.items();
    const index = controls.indexOf(document.activeElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.key === "Tab") { this.close({ restoreFocus: false }); return; }
    if (["Enter", " "].includes(event.key) && index >= 0) { event.preventDefault(); controls[index].click(); return; }
    const movement = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (movement) { event.preventDefault(); controls[(index + movement + controls.length) % controls.length]?.focus(); }
    else if (["Home", "End"].includes(event.key)) { event.preventDefault(); controls[event.key === "Home" ? 0 : controls.length - 1]?.focus(); }
  }
  close({ restoreFocus = true } = {}) {
    if (!this.opened) return;
    this.opened = false;
    this.element.classList.add("hidden");
    const anchor = this.anchor || this.trigger;
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.outside, true);
    document.removeEventListener("focusin", this.outside);
    window.removeEventListener("blur", this.blur);
    this.element.removeEventListener("keydown", this.keyboard);
    if (restoreFocus && anchor.isConnected) anchor.focus();
  }
  destroy() {
    this.close({ restoreFocus: false });
    this.trigger.removeEventListener("click", this.click);
    this.trigger.removeEventListener("keydown", this.triggerKey);
    this.element.remove();
  }
}
