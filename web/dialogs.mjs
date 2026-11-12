import { action, upload } from "./api.mjs";
import { button, directoryKinds, fileKind, formField, kindLabels, node, replace, shortCommit } from "./dom.mjs";
import { capsuleEntry } from "./markdown-paths.mjs";

export class Dialogs {
  constructor({ onCreated, onError, onRun, onRevert }) {
    Object.assign(this, { onCreated, onError, onRun, onRevert });
    this.element = document.getElementById("dialog");
  }
  form(title) {
    if (this.element.open) this.element.close();
    const form = node("form", "dialog-form");
    const header = node("div", "dialog-header");
    header.append(node("h2", "", title), button("×", () => this.element.close(), "icon-button"));
    const fields = node("div", "dialog-fields");
    const error = node("p", "error-message dialog-error");
    const actions = node("div", "dialog-actions");
    actions.append(button("取消", () => this.element.close()));
    form.append(header, fields, error, actions);
    replace(this.element, form);
    return { form, fields, error, actions };
  }
  show() { this.element.showModal(); }
  upload(cap, entry, onUploaded) {
    const markdown = cap.kind === "markdown";
    const view = this.form(markdown ? "上传 Markdown 附件" : "上传原件");
    const file = node("input", "file-input");
    file.type = "file";
    file.required = true;
    const path = node("input", "property-input");
    path.value = markdown ? "" : entry || "";
    path.required = directoryKinds.has(cap.kind);
    path.placeholder = markdown ? "assets/文件名" : cap.kind === "database" ? "media/文件名" : "相对文件路径";
    let automaticPath;
    file.addEventListener("change", () => {
      if (!file.files[0] || path.value && path.value !== automaticPath) return;
      automaticPath = `${markdown ? "assets/" : cap.kind === "database" ? "media/" : ""}${file.files[0].name}`;
      path.value = automaticPath;
    });
    view.fields.append(node("strong", "", cap.name), formField("选择文件", file));
    if (directoryKinds.has(cap.kind)) view.fields.append(formField("目标相对路径", path));
    if (markdown) view.fields.append(node("p", "property-note", "附件保存到 assets/。在正文使用 ![说明](assets/文件名) 嵌入图片、音频或视频。正文请通过编辑器保存。"));
    const submit = node("button", "button primary", "上传并保存版本");
    submit.type = "submit";
    view.actions.append(submit);
    view.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submit.disabled || !file.files[0]) return;
      submit.disabled = true;
      submit.textContent = "正在上传…";
      try {
        if (markdown && !capsuleEntry(path.value)?.startsWith("assets/")) throw new Error("Markdown 附件请保存到 assets/ 内，正文通过编辑器修改。");
        const saved = await upload(cap.name, directoryKinds.has(cap.kind) ? path.value : undefined, file.files[0], cap.token);
        this.element.close();
        onUploaded(saved);
      } catch (error) {
        view.error.textContent = error.message;
      } finally {
        submit.disabled = false;
        submit.textContent = "上传并保存版本";
      }
    });
    this.show();
  }
  create(parent = "/") {
    const view = this.form("新建 cap");
    const name = node("input", "property-input");
    name.required = true;
    name.placeholder = "例如 产品说明.md";
    name.autocomplete = "off";
    const kind = node("select", "property-input");
    for (const [value, label] of Object.entries(kindLabels)) {
      const option = node("option", "", label);
      option.value = value;
      kind.append(option);
    }
    kind.value = "markdown";
    const description = node("textarea", "property-input");
    description.rows = 3;
    description.maxLength = 180;
    const path = node("input", "property-input");
    path.value = parent || "/";
    const original = node("input", "file-input");
    original.type = "file";
    const entry = node("input", "property-input");
    entry.value = "main.mjs";
    const entryField = formField("Node 运行入口", entry);
    const fileField = formField("原件（可选）", original);
    const update = () => {
      entryField.classList.toggle("hidden", kind.value !== "code");
      fileField.classList.toggle("hidden", directoryKinds.has(kind.value));
    };
    kind.addEventListener("change", update);
    original.addEventListener("change", () => {
      const file = original.files[0];
      if (!file || name.value) return;
      name.value = file.name;
      kind.value = fileKind(file.name);
      update();
    });
    view.fields.append(formField("名称 · 全库唯一", name), formField("类别", kind), formField("简介", description), formField("挂载到虚拟路径", path), entryField, fileField);
    const submit = node("button", "button primary", "创建");
    submit.type = "submit";
    view.actions.append(submit);
    view.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      view.error.textContent = "";
      let cap;
      let mountedPath;
      try {
        cap = await action("create", {
          name: name.value.trim(), kind: kind.value, description: description.value,
          ...(kind.value === "code" ? { runtime: { engine: "node", entry: entry.value } } : {}),
        });
        if (original.files[0] && !directoryKinds.has(kind.value)) {
          submit.textContent = "上传原件…";
          cap = await upload(cap.name, undefined, original.files[0], cap.token);
        }
        const parentPath = path.value.trim().replace(/\/+$/, "");
        mountedPath = `${parentPath}/${cap.name}`;
        await action("mount", { name: cap.name, path: mountedPath });
        this.element.close();
        this.onCreated(cap, mountedPath);
      } catch (error) {
        if (cap) {
          this.element.close();
          this.onCreated(cap, null);
          this.onError(new Error(`cap 已创建，后续操作未完成：${error.message}。可在“全部 cap”中找到 ${cap.name}。`));
        } else view.error.textContent = error.message;
      } finally {
        submit.disabled = false;
        submit.textContent = "创建";
      }
    });
    update();
    this.show();
  }
  revert(cap, target, hasDraft) {
    const view = this.form("回撤到此版本");
    view.fields.append(node("strong", "", cap.name), node("div", "mono commit-value", target.commit), node("p", "muted", "内容和属性将恢复到此版本，并生成一个新提交。原有历史会保留。"));
    if (hasDraft) view.fields.append(node("p", "error-message", "当前未保存草稿会继续保留，回撤后需要核对基线。"));
    const submit = node("button", "button danger", `回撤到 ${shortCommit(target.commit)}`);
    submit.type = "submit";
    view.actions.append(submit);
    view.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        const result = await action("revert", { name: cap.name, commit: target.commit, token: cap.token });
        this.element.close();
        this.onRevert(result);
      } catch (error) {
        view.error.textContent = error.message;
        submit.disabled = false;
      }
    });
    this.show();
  }
  run(cap, hasDraft) {
    const view = this.form("在本地运行代码");
    view.fields.append(node("strong", "", cap.name), node("p", "mono muted", `${cap.runtime?.engine || "node"} · ${cap.runtime?.entry || "未声明入口"}`));
    const args = node("textarea", "property-input");
    args.rows = 4;
    args.placeholder = "每行一个参数";
    const logCap = node("input", "property-input");
    logCap.placeholder = "留空仅记录到本地数据库";
    view.fields.append(formField("参数（每行一个）", args), formField("日志数据库 cap（可选）", logCap));
    if (hasDraft) view.fields.append(node("p", "error-message", "本次运行服务端已保存版本，当前草稿不会参与运行。"));
    const submit = node("button", "button primary", "同步并运行");
    submit.type = "submit";
    view.actions.append(submit);
    view.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.element.close();
      this.onRun(cap, args.value ? args.value.split("\n") : [], logCap.value.trim() || undefined);
    });
    this.show();
  }
  agent() {
    const view = this.form("Agent 操作入口");
    view.fields.append(node("p", "muted", "Agent 通过客户端 CLI 调用同一套业务能力。代码同步和执行发生在本地客户端。"), node("pre", "run-output", "node src/cli.mjs ls /\nnode src/cli.mjs read 产品说明.md\nnode src/cli.mjs query 运行资料 --sql 'SELECT * FROM cap_run_logs'\nnode src/cli.mjs run 工具名称\nnode src/cli.mjs events"));
    this.show();
  }
}
