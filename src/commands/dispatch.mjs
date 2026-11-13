import { commandDefinition } from "./catalog.mjs";
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

const handlers = {
  activity: (api, args) => readActivity(api, { name: args.positional[0] }),
  capsule: capsuleCommand,
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
  edit: (api, args) => editText(api, { name: args.positional[0], entry: args.positional[1], oldText: args.values["old-text"], newText: args.values["new-text"], all: args.values.all, token: args.values.token }),
};

export const handlerNames = Object.keys(handlers);
export function dispatch(args, api, context) {
  return handlers[commandDefinition(args.command).handler](api, args, context);
}
