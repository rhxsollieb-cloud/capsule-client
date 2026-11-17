import { adminOperation, backupContentPath } from "../operations/admin.mjs";
import { passwordInput } from "./password-input.mjs";

export async function adminCommand(api, { command, positional, values, output }, context) {
  if (command === "grant-set") throw new Error("个人授权已停用；请使用 cap-access cap名称 --revision 当前修订 --permission read|edit|none 设置全部非管理员权限");
  if (["user-create", "credential-create"].includes(command)
    && (output?.fields || !output?.outFile && output?.maxChars !== undefined && output.maxChars < 2048))
    throw new Error("此操作可能仅返回一次凭据，不支持--fields；请使用至少2048字符预算或--out保存完整响应，尚未签发凭据");
  const [first, second] = positional;
  if (command === "backup-download") return api.download(backupContentPath(first), second, { mode: 0o600 });
  const input = Object.fromEntries(Object.entries(values).map(([key, value]) => [({ "user-id": "userId", "preview-id": "previewId", "confirmation-name": "confirmationName", action: "operation" })[key] || key, value]));
  if (Object.hasOwn(input, "password-file")) { input.password = await passwordInput(input["password-file"], context); delete input["password-file"]; }
  if (command === "whoami") return adminOperation(api, "me");
  if (command === "user-create") input.name = first;
  if (["user-update", "credential-revoke"].includes(command) || command.startsWith("backup-") && command !== "backup-create" && command !== "backup-receipt") input.id = first;
  if (command === "credential-create") input.userId = first;
  if (["grants", "cap-access", "cap-protect"].includes(command)) input.name = first;
  if (command === "cap-protect") {
    if (typeof input.protected !== "boolean") throw new Error("保护设置需要 --protected=true|false");
    return adminOperation(api, "cap-access", { name: first, revision: input.revision, permission: input.protected ? "none" : "edit" });
  }
  if (command === "backup-receipt") input.restoreId = first;
  return adminOperation(api, command, input);
}
