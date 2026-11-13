import { group as capsules } from "./catalog/capsules.mjs";
import { group as content } from "./catalog/content.mjs";
import { group as database } from "./catalog/database.mjs";
import { group as mounts } from "./catalog/mounts.mjs";
import { group as versions } from "./catalog/versions.mjs";
import { group as office } from "./catalog/office.mjs";
import { group as skills } from "./catalog/skills.mjs";
import { group as system } from "./catalog/system.mjs";
import { presentationOptions } from "./catalog/options.mjs";

export const kinds = ["text", "image", "audio", "video", "excel", "word", "file", "files", "database", "code", "markdown"];
export const groups = [capsules, content, database, mounts, versions, office, skills, system];
const definitions = groups.flatMap((group) => group.commands.map((command) => [command.name, { ...command, group: group.id }]));
if (new Set(definitions.map(([name]) => name)).size !== definitions.length) throw new Error("CLI命令名称重复");
export const commands = Object.fromEntries(definitions);

export function commandDefinition(name) {
  if (!Object.hasOwn(commands, name)) throw new Error("未知命令：" + name);
  return commands[name];
}

export function optionDefinitions(name) {
  const options = { ...commandDefinition(name).options, ...presentationOptions };
  if (!["read", "details", "guide"].includes(name)) delete options.raw;
  return options;
}
