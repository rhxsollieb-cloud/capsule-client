import { capsuleName } from "../system/paths.mjs";
import { localSkillAction } from "../skills/local-client.mjs";

export function skillCommand(api, { command, positional }) {
  return localSkillAction(api.config, command, capsuleName(positional[0]));
}
