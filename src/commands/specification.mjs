import { commands, kinds, optionDefinitions } from "./catalog.mjs";

export { kinds };
export { validateValues } from "./validation.mjs";
export const options = Object.fromEntries(Object.keys(commands).map((name) => [name, Object.keys(optionDefinitions(name))]));
export const arity = Object.fromEntries(Object.values(commands).map((command) => [command.name, command.arity]));
