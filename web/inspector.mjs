import { action } from "./api.mjs";
import { button, formField, kindLabels, node, replace, shortCommit } from "./dom.mjs";
import { icon } from "./icons.mjs";
import { InspectorContext } from "./inspector-context.mjs";

export class Inspector {
  constructor({ onSaved, onError }) {
    this.element = document.getElementById("inspector");
    this.drafts = new Map();
    this.sections = new Map();
    this.onSaved = onSaved;
    this.onError = onError;
    this.content = new InspectorContext({ onOpenEntry: (entry) => this.onOpenEntry?.(entry), onOpenTable: (table) => this.onOpenTable?.(table) });
  }
  show(cap) {
    if (this.current?.name === cap.name) { this.update(cap); return; }
    this.current = cap;
    this.element.classList.remove("hidden");
    let draft = this.drafts.get(cap.name);
    if (!draft?.dirty) {
      draft = { value: cap.description || "", original: cap.description || "", baseToken: cap.token, dirty: false };
      this.drafts.set(cap.name, draft);
    }
    this.draft = draft;
    const header = node("div", "sidebar-header");
    const close = button("", () => this.hide(), "icon-button");
    close.title = "隐藏侧边栏";
    close.setAttribute("aria-label", close.title);
    close.append(icon("close"));
    header.append(node("h2", "", "内容详情"), close);
    const identity = node("div", `inspector-identity kind-${cap.kind}`);
    identity.append(icon(cap.kind, "identity-icon"), node("span", "type-badge", kindLabels[cap.kind] || cap.kind), node("h2", "", cap.name));
    this.summary = node("p", "identity-description", cap.description || "暂无简介");
    identity.append(this.summary);
    this.content.show(cap);
    this.commit = node("div", "property-value mono commit-value", shortCommit(cap.commit));
    this.commit.title = cap.commit;
    const version = this.section("version", "版本保护");
    version.append(node("div", "property-label", "当前 Git 提交"), this.commit, node("p", "property-note", "保存核对读取时的版本；回撤通过事件队列生成新提交。"));
    const properties = this.section("properties", "属性与简介");
    properties.append(this.value("全库唯一名称", cap.name), this.value("类别", kindLabels[cap.kind] || cap.kind));
    this.description = node("textarea", "description-input property-input");
    this.description.value = draft.value;
    this.description.rows = 5;
    this.description.maxLength = 180;
    this.description.placeholder = "添加简短说明";
    this.description.addEventListener("input", () => {
      draft.value = this.description.value;
      draft.dirty = draft.value !== draft.original;
      this.saveButton.disabled = !draft.dirty;
    });
    this.note = node("p", "property-note");
    this.saveButton = button("保存说明", () => this.save());
    this.saveButton.disabled = !draft.dirty;
    properties.append(formField("简介", this.description), this.note, this.saveButton);
    this.runtime = node("div", "runtime-context");
    this.updateRuntime(cap);
    replace(this.element, header, identity, this.content.element, this.runtime, properties, version);
  }
  section(key, title) {
    const section = node("details", "property-section");
    section.open = this.sections.get(key) || false;
    section.append(node("summary", "", title));
    section.addEventListener("toggle", () => this.sections.set(key, section.open));
    return section;
  }
  value(label, value) {
    const group = node("div", "property-group");
    group.append(node("div", "property-label", label), node("div", "property-value", value));
    return group;
  }
  context(value) { this.content.context(value); }
  updateRuntime(cap) {
    this.runtime.replaceChildren();
    if (!cap.runtime) return;
    const section = node("div", "context-section");
    section.append(node("h3", "", "本地运行环境"), this.value("引擎", cap.runtime.engine), this.value("入口", cap.runtime.entry), node("p", "property-note", "点击中央运行按钮后，同步服务端版本并在客户端运行。"));
    this.runtime.append(section);
  }
  update(cap) {
    const changed = this.current.commit !== cap.commit;
    this.current = cap;
    this.commit.textContent = shortCommit(cap.commit);
    this.commit.title = cap.commit;
    this.summary.textContent = cap.description || "暂无简介";
    this.updateRuntime(cap);
    if (changed) this.content.loadNavigation(cap);
    if (!this.draft.dirty) {
      this.draft.value = cap.description || "";
      this.draft.original = cap.description || "";
      this.draft.baseToken = cap.token;
      this.description.value = this.draft.value;
    } else if (this.draft.baseToken !== cap.token) this.note.textContent = "服务端已有新版本，此草稿保留原基线。";
  }
  async save() {
    const cap = this.current;
    const draft = this.draft;
    const value = draft.value;
    this.saveButton.disabled = true;
    try {
      const saved = await action("update", { name: cap.name, description: value, token: draft.baseToken });
      draft.original = value;
      draft.baseToken = saved.token;
      draft.dirty = draft.value !== value;
      if (this.current?.name === cap.name) this.note.textContent = "说明已保存";
      this.onSaved(saved);
    } catch (error) {
      if (this.current?.name === cap.name) this.note.textContent = "保存失败，草稿已保留";
      this.onError(error);
    } finally {
      if (this.current?.name === cap.name) this.saveButton.disabled = !draft.dirty;
    }
  }
  hide() {
    this.element.classList.add("hidden");
    document.body.classList.remove("inspector-open");
  }
  toggle() {
    if (!this.current) return;
    this.element.classList.toggle("hidden");
    document.body.classList.toggle("inspector-open", !this.element.classList.contains("hidden"));
  }
}
