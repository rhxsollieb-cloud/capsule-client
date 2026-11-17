import { adminOperation, backupContentPath } from "../operations/admin.mjs";

export async function adminCommand(api, { command, positional, values, output }) {
  if (["user-create", "credential-create"].includes(command)
    && (output?.fields || !output?.outFile && output?.maxChars !== undefined && output.maxChars < 2048))
    throw new Error("此操作可能仅返回一次凭据，不支持--fields；请使用至少2048字符预算或--out保存完整响应，尚未签发凭据");
  const [first, second] = positional;
  if (command === "backup-download") return api.download(backupContentPath(first), second, { mode: 0o600 });
  const input = Object.fromEntries(Object.entries(values).map(([key, value]) => [({ "user-id": "userId", "preview-id": "previewId", "confirmation-name": "confirmationName", action: "operation" })[key] || key, value]));
  if (command === "user-create") input.name = first;
  if (["user-update", "credential-revoke"].includes(command) || command.startsWith("backup-") && command !== "backup-create" && command !== "backup-receipt") input.id = first;
  if (command === "credential-create") input.userId = first;
  if (["grants", "grant-set"].includes(command)) input.name = first;
  if (command === "grant-set") { input.userId = second; if (input.permission === "none") input.permission = null; }
  if (command === "backup-receipt") input.restoreId = first;
  return adminOperation(api, command, input);
}
