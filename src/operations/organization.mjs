export const inspectOrganization = (api, page = {}) => api.json(api.query("/api/mounts/organize", page));

export async function organizeMounts(api, input) {
  if (input.dryRun !== undefined && typeof input.dryRun !== "boolean") throw Object.assign(new Error("dryRun需要布尔值"), { status: 400, code: "BAD_REQUEST" });
  if (!input.dryRun && (input.offset || 0) > 0) throw Object.assign(new Error("正式提交不能用offset翻页，请查询receipt"), { status: 400, code: "BAD_REQUEST" });
  try { return await api.json("/api/mounts/organize", "POST", input); }
  catch (error) {
    if (!error.status && !input.dryRun) {
      error.unknownResult = true;
      error.message += "；组织提交结果未知，请用organize --receipt latest核对，不能自动重放";
    }
    throw error;
  }
}

export function organizationReceipt(api, receipt, page = {}) {
  if (typeof receipt !== "string" || !receipt) throw Object.assign(new Error("组织回执ID不能为空"), { status: 400, code: "BAD_REQUEST" });
  return api.json(api.query(`/api/mounts/organize/receipts/${encodeURIComponent(receipt)}`, page));
}
