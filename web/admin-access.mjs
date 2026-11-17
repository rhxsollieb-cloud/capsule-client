import { action } from "./api.mjs";
import { node, replace } from "./dom.mjs";
import { form, input, section } from "./admin-common.mjs";

export async function accessPage(context) {
  const name = input("cap 名称", context.capName || "", { required: true });
  const output = node("div");
  let request = 0;
  const load = async () => {
    const current = ++request;
    try {
      const record = await action("cap-access", { name: name.control.value.trim() });
      if (!context.current() || request !== current) return;
      const permission = input("非管理员权限", record.permission, {
        options: { edit: "可读取和编辑", read: "仅可读取（可复制为新 cap 编辑）", none: "不可访问" },
      });
      replace(output, section(record.name,
        node("p", "property-note", `权限修订 ${record.revision}。管理员始终拥有全部权限；此设置统一应用于所有普通员工及该 cap 的全部挂载。`),
        form([permission.field], "保存 cap 权限", () => context.perform("cap-access", {
          name: record.name, revision: record.revision, permission: permission.control.value,
        }, load)),
        node("p", "property-note", "新建与复制的 cap 默认为可读取和编辑。权限不随内容回撤恢复，不继承虚拟父目录；不设置逐员工例外。")));
    } catch (error) { if (context.current() && request === current) context.error(error); }
  };
  replace(context.body, section("胶囊权限", form([name.field], "读取 cap 权限", load)), output);
  if (context.capName) await load();
}
