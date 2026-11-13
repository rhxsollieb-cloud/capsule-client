import { button, kindLabels, node, replace } from "./dom.mjs";
import { icon } from "./icons.mjs";
import { ActionMenu } from "./menu.mjs";
import { ActivityIndicator, activityPresentation } from "./activity.mjs";

export class DocumentHeader {
  constructor(element, { onError }) {
    Object.assign(this, { element, onError });
    this.libraryToggle = button("", null, "icon-button library-toggle");
    this.libraryToggle.id = "toggle-library";
    this.libraryToggle.title = "收起知识库（⌘ / Ctrl + B）";
    this.libraryToggle.setAttribute("aria-label", "收起知识库");
    this.libraryToggle.setAttribute("aria-controls", "knowledge-navigation native-navigation");
    this.libraryToggle.setAttribute("aria-expanded", "true");
    this.libraryToggle.append(icon("library"));
    this.identity = node("div", "document-identity");
    this.mark = node("span", "document-kind");
    this.name = node("h1", "document-name", "知识库");
    this.identity.append(this.mark, this.name);
    this.status = button("", () => this.details(), "document-status hidden");
    this.status.setAttribute("aria-live", "polite");
    this.activity = new ActivityIndicator({ onOpen: (state) => this.showInformation("胶囊活动", activityPresentation(state).detail) });
    this.mode = button("", () => this.execute(this.model?.controls?.toggleMode), "icon-button contextual-action hidden");
    this.save = button("", () => this.execute(this.model?.controls?.save), "button primary document-save hidden");
    this.save.append(icon("save"), node("span", "", "保存"));
    this.save.title = "保存到知识库并核对原版本（⌘ / Ctrl + S）";
    this.more = button("", null, "icon-button document-more");
    this.more.append(icon("more"));
    this.more.title = "文件操作";
    this.more.setAttribute("aria-label", "文件操作");
    const actions = node("div", "document-commands");
    actions.append(this.activity.element, this.status, this.mode, this.save, this.more);
    this.menu = new ActionMenu(this.more, { getItems: () => this.items(), label: "文件操作", onError });
    this.identity.addEventListener("contextmenu", (event) => {
      if (!this.model?.cap) return;
      event.preventDefault();
      this.menu.open({ x: event.clientX, y: event.clientY });
    });
    this.shortcut = (event) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (event.target.closest?.("dialog, [role=menu]") || !this.model?.controls?.save) return;
      event.preventDefault();
      if (this.model.controls.canSave) this.execute(this.model.controls.save);
    };
    document.addEventListener("keydown", this.shortcut);
    replace(element, this.libraryToggle, this.identity, actions);
    this.update(null);
  }
  execute(action) {
    if (!action) return;
    try { Promise.resolve(action()).catch(this.onError); }
    catch (error) { this.onError(error); }
  }
  update(model) {
    if (this.model?.contextKey !== model?.contextKey) this.menu.close({ restoreFocus: false });
    this.model = model;
    this.activity.update(model?.activity);
    const controls = model?.controls;
    this.name.textContent = model?.name || "知识库";
    this.identity.title = model ? [model.path, controls?.detail].filter(Boolean).join("\n") : "从左侧选择内容";
    replace(this.mark, icon(model?.kind || "capsule", `kind-${model?.kind || "file"}`));
    const state = controls?.state || "clean";
    this.status.className = `document-status state-${state}${state === "clean" ? " hidden" : ""}`;
    const label = state === "dirty" ? "●" : state === "clean" ? "" : controls?.statusText || { saving: "保存中", loading: "读取中", conflict: "冲突", error: "操作失败" }[state] || "";
    if (this.status.textContent !== label) this.status.textContent = label;
    this.status.title = controls?.detail || controls?.statusText || "";
    this.status.setAttribute("aria-label", controls?.statusText || label);
    this.save.classList.toggle("hidden", !controls?.save || !(controls.canSave || state === "saving"));
    this.save.disabled = !controls?.canSave;
    this.mode.classList.toggle("hidden", !controls?.toggleMode);
    this.mode.title = controls?.mode === "read" ? "编辑 Markdown" : "预览 Markdown";
    this.mode.setAttribute("aria-label", this.mode.title);
    replace(this.mode, icon(controls?.mode === "read" ? "edit" : "eye"));
    this.more.disabled = !model?.cap;
  }
  items() {
    const model = this.model;
    if (!model) return [];
    const controls = model.controls;
    return [
      controls?.save && { label: "保存", icon: "save", shortcut: "⌘ / Ctrl S", disabled: !controls.canSave, action: controls.save },
      controls?.toggleMode && { label: controls.mode === "read" ? "编辑 Markdown" : "预览 Markdown", icon: controls.mode === "read" ? "edit" : "eye", action: controls.toggleMode },
      ...(controls?.moreItems || []).map((item) => item?.information ? {
        ...item, action: () => this.showInformation(item.information.title, item.information.values),
      } : item),
      { separator: true },
      ...(model.items || []),
      { separator: true },
      { label: "位置与版本信息", icon: "info", action: () => this.details(model) },
      controls?.helpText && { label: "保存说明", icon: "info", action: () => this.showInformation("保存说明", [controls.helpText]) },
    ];
  }
  details(model = this.model) {
    if (!model?.cap) return;
    this.showInformation("位置与版本", [model.path, `类别：${kindLabels[model.cap.kind] || model.cap.kind}`, `提交：${model.cap.commit}`, model.controls?.detail].filter(Boolean));
  }
  showInformation(title, values) {
    const dialog = node("dialog", "document-info");
    const content = node("div", "document-info-body");
    content.append(node("h2", "", title));
    for (const value of values) content.append(node("p", "", value));
    content.append(button("关闭", () => dialog.close(), "button secondary"));
    dialog.append(content);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }
}
