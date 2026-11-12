import { options, arity, validateValues } from "./specification.mjs";

export function parseArguments(argv) {
  const [command = "help", ...rest] = argv;
  if (["--help", "-h"].includes(command)) return { command: "help" };
  if (command === "help") {
    if (rest.length > 1) throw new Error("help 只接受一个命令名称");
    return { command: "help", topic: rest[0] };
  }
  if (!options[command]) throw new Error("未知命令：" + command);
  const separator = rest.indexOf("--");
  const commandArguments = separator < 0 ? rest : rest.slice(0, separator);
  if (commandArguments.includes("--help")) return { command: "help", topic: command };
  const positional = [];
  const values = {};
  const runtimeArgs = [];
  for (let index = 0; index < rest.length; index++) {
    const value = rest[index];
    if (value === "--") {
      if (command !== "run") throw new Error("只有 run 支持 -- 后的工具参数");
      runtimeArgs.push(...rest.slice(index + 1));
      break;
    }
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const split = value.indexOf("=");
    const key = value.slice(2, split < 0 ? undefined : split);
    if (!options[command].includes(key))
      throw new Error(`命令 ${command} 不支持 --${key}`);
    if (values[key] !== undefined) throw new Error(`参数 --${key} 重复`);
    const parameter = split < 0 ? rest[++index] : value.slice(split + 1);
    if (
      parameter === undefined ||
      (split < 0 && parameter.startsWith("--"))
    )
      throw new Error(`参数 --${key} 缺少值`);
    values[key] = parameter;
  }
  const [min, max] = arity[command];
  if (positional.length < min || positional.length > max) {
    const expected = min === max ? min : `${min}–${max}`;
    throw new Error(`命令 ${command} 需要 ${expected} 个位置参数`);
  }
  for (const key of ["limit", "offset", "from"]) {
    if (values[key] === undefined) continue;
    const number = Number(values[key]);
    if (!Number.isSafeInteger(number) || number < (key === "offset" ? 0 : 1))
      throw new Error(`参数 --${key} 需为有效整数`);
    values[key] = number;
  }
  validateValues(command, values);
  return { command, positional, values, runtimeArgs };
}
