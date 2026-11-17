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
  const role = input("角色", result.total === 0 ? "admin" : "editor", { options: roleLabels });
  const create = form([name.field, role.field], "创建用户", () => context.perform("user-create", { name: name.control.value.trim(), role: role.control.value }, async (saved) => {
    context.secret(saved);
    if (saved.bootstrapCredential) {
      replace(context.body, section("初始化完成", node("p", "", "请保存一次性凭据，将其配置到 CLI 与界面共用的 CAPSULE_TOKEN 环境后重启客户端。当前匿名连接已不再具备访问权限。")));
    } else await context.reload(true);
  }));
  const edit = (user) => {
    const nextName = input("名称", user.name, { required: true });
    const nextRole = input("角色", user.role, { options: roleLabels });
    const enabled = input("状态", String(user.enabled), { options: { true: "启用", false: "停用" } });
    replace(editor, section(`编辑 ${user.name}`, node("p", "mono property-note", `ID：${user.id} · 修订 ${user.revision}`),
      form([nextName.field, nextRole.field, enabled.field], "保存用户", () => context.perform("user-update", {
        id: user.id, revision: user.revision, name: nextName.control.value.trim(), role: nextRole.control.value, enabled: enabled.control.value === "true",
      }, () => context.reload()))));
  };
  const showCredentials = async (userId, pageOffset = 0) => {
    const request = ++credentialRequest;
    try {
      const records = await action("credentials", { userId, limit: 30, offset: pageOffset });
      if (!context.current() || request !== credentialRequest) return;
      const label = input("新凭据用途", "", { required: true });
      const createCredential = form([label.field], "签发凭据", () => context.perform("credential-create", { userId, label: label.control.value.trim() }, async (saved) => {
        context.secret(saved); await showCredentials(userId, pageOffset);
      }));
      replace(credentials, section("个人凭据", node("p", "mono property-note", `用户ID：${userId}`), createCredential,
        rows(records.items, [["label", "用途"], ["id", "凭据ID"], [(item) => item.enabled ? "启用" : "已撤销", "状态"], ["revision", "修订"]], (item) => [
          item.enabled && button("撤销…", () => {
            if (!confirm(`撤销凭据“${item.label}”？使用它的客户端将失去访问权限，此操作不可恢复。`)) return;
            context.perform("credential-revoke", { id: item.id, revision: item.revision }, () => showCredentials(userId, pageOffset));
          }, "button danger"),
        ]), pagination(records, pageOffset, (next) => showCredentials(userId, next))));
    } catch (error) { context.error(error); }
  };
  replace(context.body, section("用户", create,
    rows(result.items, [["name", "名称"], [(item) => roleLabels[item.role] || item.role, "角色"], [(item) => item.enabled ? "启用" : "停用", "状态"], ["id", "用户ID"]], (item) => [
      button("编辑", () => edit(item)), button("凭据", () => showCredentials(item.id)),
    ]), pagination(result, offset, (next) => context.load("users", next))), editor, credentials);
}

export async function grantsPage(context) {
  const name = input("cap 名称", context.capName || "", { required: true });
  const output = node("div");
  let request = 0;
  const load = async () => {
    const current = ++request;
    try {
      const record = await action("grants", { name: name.control.value.trim() });
      if (!context.current() || request !== current) return;
      const userId = input("用户ID", "", { required: true });
      const permission = input("授权", "read", { options: { read: "读取", edit: "编辑", none: "撤销授权" } });
      replace(output, section(record.name, node("p", "property-note", `授权集合修订 ${record.revision}。授权绑定 cap 实体；同一 cap 的所有挂载遵循同一权限，管理员始终可管理。`),
        rows(record.items, [["userId", "用户ID"], [(item) => item.permission === "edit" ? "编辑" : "读取", "授权"]]),
        form([userId.field, permission.field], "保存授权", () => context.perform("grant-set", {
          name: record.name, revision: record.revision, userId: userId.control.value.trim(), permission: permission.control.value === "none" ? null : permission.control.value,
        }, load))));
    } catch (error) { context.error(error); }
  };
  replace(context.body, section("胶囊权限", form([name.field], "读取授权", load)), output);
  if (context.capName) await load();
}
