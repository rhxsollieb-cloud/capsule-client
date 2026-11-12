import { action } from "./api.mjs";
import { button, node, replace, shortCommit } from "./dom.mjs";
import { icon } from "./icons.mjs";
import { renderMarkdown } from "./markdown.mjs";

export class TextEditor {
  constructor({ onSaved, onError, onDirty }) {
    this.drafts = new Map();
    this.onSaved = onSaved;
    this.onError = onError;
    this.onDirty = onDirty;
  }
  key(name, entry) { return `${name}\0${entry ?? ""}`; }
  hasDirty(name, entry) { return Boolean(this.drafts.get(this.key(name, entry))?.dirty); }
  open(container, cap, entry, record) {
    const key = this.key(cap.name, entry);
    let draft = this.drafts.get(key);
    if (!draft?.dirty) {
      draft = { body: record.body, original: record.body, baseToken: record.token, baseCommit: record.commit, dirty: false };
      this.drafts.set(key, draft);
    }
    const page = node("div", "editor-page");
    const markdown = /\.md$/i.test(entry || cap.name);
    const toolbar = node("div", "reading-toolbar");
    const reading = node("div", "reading-surface");
    let mode = markdown && !draft.dirty ? "read" : "edit";
    const banner = node("div", "editor-notice");
    this.current = { key, banner, cap, entry, remote: draft.baseToken !== record.token };
    const shell = node("div", "editor-shell");
    const gutter = node("pre", "line-gutter");
    gutter.setAttribute("aria-hidden", "true");
    const input = node("textarea", "text-editor");
    input.value = draft.body;
    input.spellcheck = false;
    input.wrap = "off";
    input.setAttribute("aria-label", entry || cap.name);
    const footer = node("div", "editor-footer");
    const detail = node("span", "muted");
    const save = button("保存", () => this.save(cap, entry, draft, save, detail));
    save.className = "button primary";
    save.prepend(icon("save"));
    const update = () => {
      gutter.textContent = Array.from({ length: Math.max(1, input.value.split("\n").length) }, (_, index) => index + 1).join("\n");
      save.disabled = !draft.dirty || draft.saving;
      detail.textContent = `${draft.dirty ? "未保存" : "已保存"} · 基于 ${shortCommit(draft.baseCommit)} · ${input.value.split("\n").length} 行`;
    };
    const readButton = button("阅读", () => switchMode("read"), "button ghost");
    const editButton = button(markdown ? "编辑 Markdown" : "源代码", () => switchMode("edit"), "button ghost");
    const switchMode = (next) => {
      mode = next;
      shell.classList.toggle("hidden", mode === "read");
      reading.classList.toggle("hidden", mode !== "read");
      readButton.classList.toggle("active", mode === "read");
      editButton.classList.toggle("active", mode === "edit");
      if (mode === "read") replace(reading, renderMarkdown(draft.body));
    };
    toolbar.append(node("span", "content-eyebrow", markdown ? "MARKDOWN" : (entry || cap.name).split(".").at(-1).toUpperCase()));
    if (markdown) toolbar.append(readButton, editButton);
    else toolbar.append(node("span", "muted", "UTF-8 · 直接编辑原生文件"));
    input.addEventListener("input", () => {
      draft.body = input.value;
      draft.dirty = draft.body !== draft.original;
      this.onDirty(cap.name, entry, draft.dirty);
      this.renderNotice(key);
      update();
    });
    input.addEventListener("scroll", () => { gutter.scrollTop = input.scrollTop; });
    input.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (draft.dirty && !draft.saving) this.save(cap, entry, draft, save, detail);
      }
      if (event.key === "Tab") {
        event.preventDefault();
        input.setRangeText("  ", input.selectionStart, input.selectionEnd, "end");
        input.dispatchEvent(new Event("input"));
      }
    });
    shell.append(gutter, input);
    footer.append(detail, save);
    page.append(toolbar, banner, reading, shell, footer);
    replace(container, page);
    this.renderNotice(key);
    update();
    switchMode(mode);
  }
  renderNotice(key) {
    if (this.current?.key !== key) return;
    const { banner, cap, entry, remote } = this.current;
    const draft = this.drafts.get(key);
    banner.replaceChildren();
    if (!draft?.dirty) return;
    if (remote) banner.append(node("span", "error-message remote-notice", "服务端已有新版本。草稿和原基线已保留，请核对后保存。"));
    banner.append(button("放弃草稿并重载", () => {
      this.drafts.delete(key);
      this.onDirty(cap.name, entry, false);
      this.onSaved(cap, { reload: true });
    }, "button ghost"));
  }
  markRemote(name, entry) {
    const key = this.key(name, entry);
    const draft = this.drafts.get(key);
    if (!draft?.dirty || this.current?.key !== key) return;
    this.current.remote = true;
    this.renderNotice(key);
  }
  async save(cap, entry, draft, buttonElement, detail) {
    if (draft.saving || !draft.dirty) return;
    const sentBody = draft.body;
    draft.saving = true;
    buttonElement.disabled = true;
    detail.textContent = "正在保存…";
    try {
      const saved = await action("save", { name: cap.name, entry, body: sentBody, token: draft.baseToken });
      draft.original = sentBody;
      draft.baseToken = saved.token;
      draft.baseCommit = saved.commit;
      draft.dirty = draft.body !== sentBody;
      this.onDirty(cap.name, entry, draft.dirty);
      this.onSaved(saved, { reload: false });
      detail.textContent = `${draft.dirty ? "另有未保存修改" : "已保存"} · ${shortCommit(saved.commit)}`;
    } catch (error) {
      detail.textContent = error.status === 409 ? "版本冲突 · 草稿已保留" : "保存失败 · 草稿已保留";
      this.onError(error);
    } finally {
      draft.saving = false;
      buttonElement.disabled = !draft.dirty;
      this.renderNotice(this.key(cap.name, entry));
    }
  }
}
