import { action, sessionUrl } from "./api.mjs";
import { button, node, replace } from "./dom.mjs";
import { details, form, input, pagination, rows, section } from "./admin-common.mjs";

export async function backupsPage(context, offset = 0) {
  const result = await action("backups", { limit: 30, offset });
  if (!context.current()) return;
  const label = input("备份说明（可选）");
  const output = node("div");
  const show = (record) => {
    const title = record.status === "failed" ? "操作失败" : record.status === "running" ? "操作仍在进行" : "操作结果";
    replace(output, section(title, details(record)));
  };
  const receiptId = input("操作回执ID", "", { required: true });
  const receipt = form([receiptId.field], "查询原操作", () => context.perform("backup-receipt", { restoreId: receiptId.control.value.trim() }, show));
  const create = form([label.field], "创建完整备份", () => context.perform("backup-create", { label: label.control.value.trim() || undefined }, () => context.reload(), (error) => { receiptId.control.value = error.operationId || ""; }));
  const offline = node("details", "admin-offline");
  offline.append(node("summary", "", "认领离线备份"));
  const backupId = input("备份ID", "", { required: true });
  const checksum = input("外存 SHA-256", "", { required: true });
  offline.append(node("p", "property-note", "供新服务恢复原目录库丢失的备份登记：由维护者先将备份放入服务端配置的备份区，提供独立保存的校验值。这里不接收文件路径或上传归档。"),
    form([backupId.field, checksum.field], "校验并认领", () => context.perform("backup-register", { id: backupId.control.value.trim(), checksum: checksum.control.value.trim() }, () => context.reload())));
  const restore = (item) => context.perform("backup-restore-preview", { id: item.id }, (preview) => {
    const confirmation = input(`输入 ${preview.confirmationName} 以确认`, "", { required: true });
    let submitted = false;
    const submit = form([confirmation.field], "恢复到隔离区", () => {
      if (submitted) return;
      if (confirmation.control.value !== preview.confirmationName) { context.error(new Error("确认名称不一致，尚未提交恢复")); return; }
      submitted = true;
      submit.querySelector("button").disabled = true;
      context.perform("backup-restore", {
        id: item.id, previewId: preview.previewId, checksum: preview.checksum, confirmationName: confirmation.control.value,
      }, show, () => {
        output.append(button("查询原恢复回执", () => context.perform("backup-receipt", { restoreId: preview.restoreId }, show)));
      });
    });
    replace(output, section("隔离恢复预演", node("p", "", "恢复仅创建服务端配置的隔离工作区，不覆盖当前知识库。恢复后的个人凭据需重新签发，旧Office会话将失效。保留此恢复ID，网络结果未知时先查询原回执。"),
      details(preview), submit, button("查询原恢复回执", () => context.perform("backup-receipt", { restoreId: preview.restoreId }, show))));
  });
  replace(context.body, section("完整备份", node("p", "property-note", "备份包含知识库原件、元数据与版本，可能含敏感数据；下载后请按公司要求保存。恢复后的隔离库需经核验后由维护者安排切换。"), create, offline,
    rows(result.items, [["id", "备份ID"], ["label", "说明"], ["status", "状态"], ["createdAt", "创建时间"]], (item) => {
      const download = node("a", "button secondary", "下载"); download.href = sessionUrl("/ui/admin/backup-content", { id: item.id }); download.download = "";
      return [button("详情", () => context.perform("backup-inspect", { id: item.id }, show)), button("校验", () => context.perform("backup-verify", { id: item.id }, show)), download, button("隔离恢复…", () => restore(item))];
    }), pagination(result, offset, (next) => context.load("backups", next))), section("核对未知结果", receipt), output);
}
