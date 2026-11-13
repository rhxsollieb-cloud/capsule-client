import { inspectOrganization, organizationReceipt, organizeMounts } from "../operations/organization.mjs";
import { readJsonInput } from "./input.mjs";

export async function organizationCommand(api, { values }, context) {
  const page = Object.fromEntries(["limit", "offset"].filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));
  if (values.inspect) return inspectOrganization(api, page);
  if (values.receipt) return organizationReceipt(api, values.receipt, page);
  return organizeMounts(api, { plan: await readJsonInput(values.plan, context), dryRun: Boolean(values["dry-run"]), ...page });
}
