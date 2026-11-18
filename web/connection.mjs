import { connectionAction, connectionStatus } from "./api.mjs";
import { button, formField, node, replace } from "./dom.mjs";

function field(label, type, value = "", autocomplete = "off") {
  const control = node("input");
  control.type = type;
  control.value = value;
  control.autocomplete = autocomplete;
  control.required = true;
  control.spellcheck = false;
  return { control, element: formField(label, control) };
}

export class Connection {
  constructor({ canChange = () => true, onChanged = () => location.reload() } = {}) {
    Object.assign(this, { canChange, onChanged });
    this.element = node("dialog", "connection-dialog");
    this.element.setAttribute("aria-label", "连接与登录");
    this.element.addEventListener("cancel", (event) => { if (this.required || this.busy) event.preventDefault(); });
    this.element.addEventListener("close", () => { replace(this.element); this.setGate(false); });
    document.body.append(this.element);
  }
  setGate(required) {
    this.required = required;
    document.querySelector(".app")?.classList.toggle("login-required", required);
  }
  async open({ required = false, identity } = {}) {
    if (this.busy) return;
    this.setGate(required);
    this.identity = identity || this.identity;
    this.element.classList.toggle("connection-required", required);
    if (!this.element.open) this.element.showModal();
    replace(this.element, node("p", "loading", "正在读取连接…"));
    try { this.render(await connectionStatus()); }
    catch (error) { this.render({ error: error.message }); }
  }
  render(status) {
    this.passwordEditor = null;
    const title = node("div", "dialog-header");
    title.append(node("h2", "", this.required ? "连接你的知识库" : "连接与账户"));
    if (!this.required) title.append(button("×", () => { if (!this.busy) this.element.close(); }, "icon-button"));
    this.note = node("p", "connection-note", status.error || "");
    this.note.setAttribute("role", "status");
    const content = node("div", "connection-fields");
    if (status.authenticated) {
      const principal = status.principal;
      this.identity = principal;
      content.append(node("p", "connection-identity", `${principal.name} · ${principal.username || ""} · ${{ admin: "管理员", editor: "普通员工" }[principal.role] || principal.role}`));
    }
    content.append(node("p", "property-note", "使用管理员提供的知识库与 Office 服务地址。人与 Agent 共用账号和本机登录会话，密码不会保存。"));
    const server = field("知识库服务器", "url", status.serverUrl);
    const office = field("Office 服务", "url", status.officeEditorUrl);
    const username = field("用户名", "text", status.principal?.username || this.identity?.username || "", "username");
    const password = field("密码", "password", "", "current-password");
    const form = node("form", "connection-form");
    form.append(server.element, username.element, password.element);
    const advanced = node("details", "connection-advanced");
    advanced.open = !office.control.value;
    advanced.append(node("summary", "", "Office 连接设置"), office.element);
    form.append(advanced);
    const submit = node("button", "button primary", status.authenticated ? "登录 / 切换账户" : "连接并登录");
    submit.type = "submit";
    form.append(submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.perform("login", { username: username.control.value.trim(), password: password.control.value,
        serverUrl: server.control.value.trim(), officeEditorUrl: office.control.value.trim() }, () => { password.control.value = ""; });
    });
    content.append(form);
    if (status.authenticated) {
      const actions = node("div", "connection-account-actions");
      actions.append(button("修改密码", () => this.passwordForm(content)), button("退出登录", () => this.perform("logout", {})));
      content.append(actions);
    }
    replace(this.element, title, this.note, content);
  }
  passwordForm(content) {
    if (this.busy || this.passwordEditor) return;
    const form = node("form", "connection-form connection-password-form");
    this.passwordEditor = form;
    const current = field("当前密码", "password", "", "current-password");
    const next = field("新密码", "password", "", "new-password");
    const confirmation = field("再次输入新密码", "password", "", "new-password");
    const submit = node("button", "button primary", "修改密码并重新登录");
    submit.type = "submit";
    form.append(current.element, next.element, confirmation.element, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (next.control.value !== confirmation.control.value) { this.note.textContent = "两次输入的新密码不同"; return; }
      await this.perform("password", { currentPassword: current.control.value, newPassword: next.control.value }, () => {
        current.control.value = ""; next.control.value = ""; confirmation.control.value = "";
      });
    });
    content.append(form);
    current.control.focus();
  }
  async perform(operation, values, clear = () => {}) {
    if (this.busy) return;
    try {
      if (!await this.canChange(operation, values)) return;
      this.busy = true;
      this.element.classList.add("connection-busy");
      this.note.textContent = "正在处理…";
      const result = await connectionAction(operation, values);
      clear();
      const status = await connectionStatus();
      this.element.close();
      this.busy = false;
      await this.onChanged(operation, status, result);
    } catch (error) {
      clear();
      this.note.textContent = error.message;
      this.note.classList.add("error-message");
    } finally { this.busy = false; this.element.classList.remove("connection-busy"); }
  }
}
