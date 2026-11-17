import { action } from "./api.mjs";
import { button, node, replace } from "./dom.mjs";
import { form, input, pagination, roleLabels, rows, section } from "./admin-common.mjs";

export async function usersPage(context, offset = 0) {
  const result = await action("users", { limit: 30, offset });
  if (!context.current()) return;
  const editor = node("div");
  const credentials = node("div");
  let credentialRequest = 0;
  const name = input("名称", "", { required: true });
  const username = input("登录用户名", "", { required: true });
  const password = input("初始密码", "", { required: true, type: "password" });
  const role = input("角色", result.total === 0 ? "admin" : "editor", { options: roleLabels });
  const create = form([name.field, username.field, password.field, role.field], "创建用户", () => context.perform("user-create", {
    name: name.control.value.trim(), username: username.control.value.trim(), password: password.control.value, role: role.control.value,
  }, async (saved) => {
    password.control.value = "";
    context.secret(saved);
    if (saved.bootstrapCredential) {
      replace(context.body, section("初始化完成", node("p", "", "请用新管理员的用户名和密码登录。初始化凭据仅显示一次，供维护或独立 Agent 使用。")));
    } else await context.reload(true);
  }));
  const edit = (user) => {
    const nextName = input("名称", user.name, { required: true });
    const nextUsername = input("登录用户名", user.username || "");
    const nextPassword = input("重设密码（留空保留）", "", { type: "password" });
    const nextRole = input("角色", user.role, { required: true, options: roleLabels });
    const enabled = input("状态", String(user.enabled), { options: { true: "启用", false: "停用" } });
    replace(editor, section(`编辑 ${user.name}`, node("p", "mono property-note", `ID：${user.id} · 修订 ${user.revision}`),
      form([nextName.field, nextUsername.field, nextPassword.field, nextRole.field, enabled.field], "保存用户", () => context.perform("user-update", {
        id: user.id, revision: user.revision, name: nextName.control.value.trim(), role: nextRole.control.value, enabled: enabled.control.value === "true",
        ...(nextUsername.control.value.trim() ? { username: nextUsername.control.value.trim() } : {}),
        ...(nextPassword.control.value ? { password: nextPassword.control.value } : {}),
      }, () => context.reload()))));
  };
  const showCredentials = async (userId, pageOffset = 0) => {
    const request = ++credentialRequest;
    try {
      const records = await action("credentials", { userId, limit: 30, offset: pageOffset });
      if (!context.current() || request !== credentialRequest) return;
      const label = input("兼容访问令牌用途", "", { required: true });
      const createCredential = form([label.field], "签发凭据", () => context.perform("credential-create", { userId, label: label.control.value.trim() }, async (saved) => {
        context.secret(saved); await showCredentials(userId, pageOffset);
      }));
      const compatibility = node("details", "connection-advanced");
      compatibility.append(node("summary", "", "兼容旧脚本的访问令牌"), createCredential);
      replace(credentials, section("会话与访问令牌", node("p", "mono property-note", `用户ID：${userId}`),
        node("p", "property-note", "人与 Agent 使用同一用户名密码登录。可在此撤销已登录设备的会话；仅旧脚本需要额外访问令牌。"), compatibility,
        rows(records.items, [["label", "用途"], [(item) => item.kind === "session" ? "登录会话" : "兼容访问令牌", "类型"], ["id", "凭据ID"], [(item) => item.enabled ? "启用" : "已撤销", "状态"], ["revision", "修订"]], (item) => [
          item.enabled && button("撤销…", () => {
            if (!confirm(`撤销凭据“${item.label}”？使用它的客户端将失去访问权限，此操作不可恢复。`)) return;
            context.perform("credential-revoke", { id: item.id, revision: item.revision }, () => showCredentials(userId, pageOffset));
          }, "button danger"),
        ]), pagination(records, pageOffset, (next) => showCredentials(userId, next))));
    } catch (error) { context.error(error); }
  };
  replace(context.body, section("用户", create,
    rows(result.items, [["name", "名称"], ["username", "登录用户名"], [(item) => roleLabels[item.role] || item.role, "角色"], [(item) => item.enabled ? "启用" : "停用", "状态"], ["id", "用户ID"]], (item) => [
      button("编辑", () => edit(item)), button("凭据", () => showCredentials(item.id)),
    ]), pagination(result, offset, (next) => context.load("users", next))), editor, credentials);
}
