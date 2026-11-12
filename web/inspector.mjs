import { action } from "./api.mjs";
import { button, formField, kindLabels, node, replace, shortCommit } from "./dom.mjs";
import { icon } from "./icons.mjs";

export class Inspector {
  constructor({ onSaved, onError }) {
    this.element = document.getElementById("inspector");
    this.drafts = new Map();
    this.onSaved = onSaved;
    this.onError = onError;
  }
  show(cap) {
    if (this.current?.name === cap.name) {
      this.update(cap);
      return;
    }
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
    close.title = "隐藏属性";
    close.setAttribute("aria-label", "隐藏属性");
    close.append(icon("close"));
    header.append(node("h2", "", "属性"), close);
    const information = node("div", "property-group");
    information.append(this.value("名称", cap.name), this.value("类别", kindLabels[cap.kind] || cap.kind));
    this.commit = node("div", "property-value mono commit-value", shortCommit(cap.commit));
    this.commit.title = cap.commit;
    const version = node("div", "property-group");
    version.append(node("div", "property-label", "当前提交"), this.commit);
    this.description = node("textarea", "description-input property-input");
    this.description.value = draft.value;
    this.description.rows = 6;
    this.description.maxLength = 180;
    this.description.placeholder = "添加简短说明";
    this.description.addEventListener("input", () => {
      draft.value = this.description.value;
      draft.dirty = draft.value !== draft.original;
      this.saveButton.disabled = !draft.dirty;
    });
    this.note = node("p", "muted property-note");
    this.saveButton = button("保存说明", () => this.save());
    this.saveButton.disabled = !draft.dirty;
    const group = node("div", "property-group");
    group.append(formField("简介", this.description), this.note, this.saveButton);
    const runtime = cap.runtime ? this.value("运行入口", `${cap.runtime.engine} · ${cap.runtime.entry}`) : null;
    replace(this.element, header, information, version, group, runtime);
  }
  value(label, value) {
    const group = node("div", "property-group");
    group.append(node("div", "property-label", label), node("div", "property-value", value));
    return group;
  }
  update(cap) {
    this.current = cap;
    this.commit.textContent = shortCommit(cap.commit);
    this.commit.title = cap.commit;
    if (!this.draft.dirty) {
      this.draft.value = cap.description || "";
      this.draft.original = cap.description || "";
      this.draft.baseToken = cap.token;
      this.description.value = this.draft.value;
    } else if (this.draft.baseToken !== cap.token) {
      this.note.textContent = "服务端已有新版本，此草稿保留原基线。";
    }
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
