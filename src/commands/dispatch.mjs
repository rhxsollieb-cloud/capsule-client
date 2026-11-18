import { commandDefinition, leaseWriteCommands } from "./catalog.mjs";
import { capsuleCommand } from "./capsules.mjs";
import { dataCommand } from "./data.mjs";
import { detailsCommand } from "./details.mjs";
import { discoveryCommand } from "./discovery.mjs";
import { eventCommand } from "./events.mjs";
import { guideCommand } from "./guide.mjs";
import { managementCommand } from "./management.mjs";
import { mountCommand } from "./mounts.mjs";
import { officeSessionCommand } from "./office-session.mjs";
import { organizationCommand } from "./organization.mjs";
import { skillCommand } from "./skills.mjs";
import { structuredWriteCommand } from "./structured-write.mjs";
import { editText } from "../operations/content.mjs";
import { readActivity } from "../operations/activity.mjs";
import { readTable } from "../database/tables.mjs";
import { previewOffice } from "../preview/office.mjs";
import { synchronize } from "../cache/sync.mjs";
import { runCapsule } from "../runtime/run.mjs";
import { doctor } from "../runtime/doctor.mjs";
import { adminCommand } from "./admin.mjs";
import { leaseCommand } from "./leases.mjs";
import { leasedApi } from "../operations/leases.mjs";
import { authCommand } from "./auth.mjs";
import { copyCommand } from "./copy.mjs";
import { importCommand } from "./import.mjs";
import { importBatchCommand } from "./import-batch.mjs";

const handlers = {
  auth: authCommand,
  admin: adminCommand,
  leases: leaseCommand,
  activity: (api, args) => readActivity(api, { name: args.positional[0] }),
  capsule: capsuleCommand,
  copy: copyCommand,
  import: importCommand,
  importBatch: importBatchCommand,
  data: dataCommand,
  details: detailsCommand,
  discovery: discoveryCommand,
  events: eventCommand,
  guide: guideCommand,
  management: managementCommand,
  mounts: mountCommand,
  officeSession: officeSessionCommand,
  organization: organizationCommand,
  skills: skillCommand,
  structuredWrite: structuredWriteCommand,
  health: (api) => api.json("/api/health"),
  doctor: (api) => doctor(api.config),
  paths: async (api) => (await import("../storage/paths.mjs")).clientPaths(api.config),
  table: (api, args) => readTable(api, args.positional[0], { table: args.positional[1], ...args.values }),
  preview: (api, args) => previewOffice(api, args.positional[0], args.positional[1]),
  sync: (api, args) => synchronize(api, args.positional[0]),
  run: (api, args) => runCapsule(api, args.positional[0], args.runtimeArgs, { logCap: args.values["log-cap"] }),
  edit: (api, { positional: [name, entry], values }) => editText(api, {
    name, entry, oldText: values["old-text"], newText: values["new-text"], all: values.all,
    token: values.token, dryRun: values["dry-run"], description: values.description,
  }),
};

export const handlerNames = Object.keys(handlers);
export function dispatch(args, api, context) {
  if (leaseWriteCommands.has(args.command)) {
    const readOnly = args.command === "office-open" && args.values.mode === "view" || args.command === "edit" && args.values["dry-run"];
    if (!readOnly) api = leasedApi(api, args.values.lease || api.config?.leaseToken);
    args = { ...args, values: Object.fromEntries(Object.entries(args.values).filter(([key]) => key !== "lease")) };
  }
  return handlers[commandDefinition(args.command).handler](api, args, context);
}
