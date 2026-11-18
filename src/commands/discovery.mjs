import { overview, scanCapsules, searchCapsules, whereCapsule } from "../operations/discovery.mjs";

export function discoveryCommand(api, { command, positional, values, output }) {
  if (command === "overview") return overview(api);
  if (command === "where") return whereCapsule(api, positional[0], values);
  const { "scan-all": scanAll, ...query } = values;
  const input = { ...query, path: positional[0] || "/" };
  return scanAll ? scanCapsules(api, input, output) : searchCapsules(api, input);
}
