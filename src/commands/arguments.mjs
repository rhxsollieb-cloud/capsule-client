import { commandDefinition, optionDefinitions } from "./catalog.mjs";
import { presentationOptions } from "./catalog/options.mjs";
import { validateValues } from "./validation.mjs";

function parseHelp(rest) {
  const json = rest.includes("--json");
  const topics = rest.filter((value) => value !== "--json");
  if (topics.length > 1 || topics.some((value) => value.startsWith("-")))
    throw new Error("help只接受一个命令或帮助组，可追加--json");
  return { command: "help", topic: topics[0], ...(json ? { helpJson: true } : {}) };
}

function optionValue(key, parameter, definition) {
  if (definition.type === "integer") {
    const number = Number(parameter);
    if (!/^-?\d+$/u.test(parameter) || !Number.isSafeInteger(number) || number < definition.minimum || number > definition.maximum)
      throw new Error(`参数 --${key} 需为 ${definition.minimum}..${definition.maximum} 的有效整数`);
    return number;
  }
  return parameter;
}

function presentation(values, command) {
  const output = {};
  for (const [flag, key] of [["fields", "fields"], ["raw", "raw"], ["max-chars", "maxChars"], ["out", "outFile"], ["json-errors", "jsonErrors"]]) {
    if (values[flag] !== undefined) { output[key] = values[flag]; delete values[flag]; }
  }
  if (output.raw && !["read", "details", "guide"].includes(command)) throw new Error("--raw仅支持read/details/guide主题正文");
  if (output.raw && (output.fields !== undefined || output.outFile !== undefined)) throw new Error("--raw不能同时使用--fields或--out");
  if (output.fields !== undefined) {
    const fields = output.fields.split(",").map((field) => field.trim());
    if (fields.some((field) => !field || /[\x00-\x1f]/.test(field) || ["__proto__", "constructor", "prototype"].includes(field)))
      throw new Error("--fields需要有效的逗号分隔字段名称");
    output.fields = [...new Set(fields)];
  }
  if (output.outFile !== undefined && !output.outFile) throw new Error("--out不能为空");
  return output;
}

export function parseArguments(argv) {
  const [command = "help", ...rest] = argv;
  if (["help", "--help", "-h"].includes(command)) return parseHelp(rest);
  const definition = commandDefinition(command);
  const definitions = optionDefinitions(command);
  const positional = [];
  const values = {};
  const runtimeArgs = [];
  let helpRequested = false;
  let helpJson = false;
  for (let index = 0; index < rest.length; index++) {
    const value = rest[index];
    if (value === "--") {
      const remaining = rest.slice(index + 1);
      if (command === "run") runtimeArgs.push(...remaining);
      else positional.push(...remaining);
      break;
    }
    if (value === "--help" || value === "-h") { helpRequested = true; continue; }
    if (value === "--json") { helpJson = true; continue; }
    if (!value.startsWith("--")) { positional.push(value); continue; }
    const split = value.indexOf("=");
    const key = value.slice(2, split < 0 ? undefined : split);
    if (!Object.hasOwn(definitions, key)) throw new Error(`命令 ${command} 不支持 --${key}`);
    if (Object.hasOwn(values, key)) throw new Error(`参数 --${key} 重复`);
    const option = definitions[key];
    if (option.type === "boolean") {
      const boolean = split < 0 ? "true" : value.slice(split + 1);
      if (!["true", "false"].includes(boolean)) throw new Error(`参数 --${key} 只接受true/false`);
      values[key] = boolean === "true";
      continue;
    }
    const parameter = split < 0 ? rest[++index] : value.slice(split + 1);
    if (parameter === undefined || (split < 0 && parameter.startsWith("--"))) throw new Error(`参数 --${key} 缺少值`);
    values[key] = optionValue(key, parameter, option);
  }
  if (helpRequested) return { command: "help", topic: command, ...(helpJson ? { helpJson: true } : {}) };
  if (helpJson) throw new Error("命令 " + command + " 的--json仅与--help一起使用");
  const [min, max] = definition.arity;
  if (positional.length < min || positional.length > max)
    throw new Error(`命令 ${command} 需要 ${min === max ? min : `${min}–${max}`} 个位置参数`);
  const output = presentation(values, command);
  for (const key of Object.keys(values)) if (Object.hasOwn(presentationOptions, key)) delete values[key];
  validateValues(command, values, positional);
  return { command, positional, values, runtimeArgs, ...(Object.keys(output).length ? { output } : {}) };
}
