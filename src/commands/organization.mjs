import { inspectOrganization, organizationReceipt, organizeMounts } from "../operations/organization.mjs";
import { readJsonInput, TEXT_INPUT_LIMIT } from "./input.mjs";

const invalid = (message) => Object.assign(new Error(message), { status: 400, code: "BAD_REQUEST" });

function planInput(input) {
  if (input?.prepared !== true) return input;
  if (input.dryRun !== true || !input.plan || typeof input.baseline !== "string" || input.plan.baseline !== input.baseline)
    throw invalid("预演文件缺少原计划或基线不一致，请核对原文件");
  return input.plan;
}

async function preparePlan(api, operations, page) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 200)
    throw invalid("--prepare 需要包含1至200项位置操作的JSON数组");
  const { version, baseline } = await inspectOrganization(api, { limit: 1 });
  if (version !== 1 || typeof baseline !== "string" || !baseline)
    throw Object.assign(new Error("服务端未返回有效的位置基线"), { status: 502, code: "INVALID_RESPONSE" });
  const plan = { version, baseline, operations };
  const preview = await organizeMounts(api, { plan, dryRun: true, ...page });
  if (preview.dryRun !== true || preview.baseline !== baseline)
    throw Object.assign(new Error("服务端未返回同基线的位置预演"), { status: 502, code: "INVALID_RESPONSE" });
  const prepared = { ...preview, prepared: true, plan };
  if (Buffer.byteLength(JSON.stringify(prepared, null, 2) + "\n") > TEXT_INPUT_LIMIT)
    throw Object.assign(new Error("预演文件超过1MiB，请减小--limit或拆分操作后重试"), { status: 413, code: "PLAN_TOO_LARGE" });
  return prepared;
}

export async function organizationCommand(api, { values }, context) {
  const page = Object.fromEntries(["limit", "offset"].filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));
  if (values.inspect) return inspectOrganization(api, page);
  if (values.receipt) return organizationReceipt(api, values.receipt, page);
  if (values.prepare !== undefined) return preparePlan(api, await readJsonInput(values.prepare, context), page);
  return organizeMounts(api, { plan: planInput(await readJsonInput(values.plan, context)), dryRun: Boolean(values["dry-run"]), ...page });
}
