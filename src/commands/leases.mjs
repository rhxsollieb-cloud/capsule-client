import { leaseOperation } from "../operations/leases.mjs";

export function leaseCommand(api, { command, positional, values, output }) {
  if (command === "lease-acquire" && (output?.fields || !output?.outFile && output?.maxChars !== undefined && output.maxChars < 2048))
    throw new Error("获取占用需要完整保留凭证，不支持--fields；请增大输出预算或用--out保存，尚未获取占用");
  const lease = values.lease || api.config?.leaseToken;
  return leaseOperation(api, command, { name: positional[0], ...values, ...(["lease-renew", "lease-release"].includes(command) && lease ? { lease } : {}) });
}
