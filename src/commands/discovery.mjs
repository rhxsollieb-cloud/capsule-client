import { overview, searchCapsules, whereCapsule } from "../operations/discovery.mjs";

export function discoveryCommand(api, { command, positional, values }) {
  if (command === "overview") return overview(api);
  if (command === "where") return whereCapsule(api, positional[0], values);
  return searchCapsules(api, { ...values, path: positional[0] || "/" });
}
