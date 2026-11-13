import { commandDefinition, kinds } from "./catalog.mjs";
import { CLI_ENTRY } from "../skills/format.mjs";

export function validateValues(command, values) {
  if (values.kind !== undefined && !kinds.includes(values.kind))
    throw new Error("类别需为 " + kinds.join("、"));
  for (const [key, option] of Object.entries(commandDefinition(command).options))
    if (option.required && (values[key] === undefined || (option.nonempty && values[key] === "")))
      throw new Error(option.missing || `需要--${key}参数，请查看${command}帮助`);
  if (["create", "update"].includes(command)) {
    if (Boolean(values.engine) !== Boolean(values.entry))
      throw new Error("运行配置需同时提供 --engine 和 --entry");
    if (values.engine !== undefined && (values.engine !== "node" || values.entry !== CLI_ENTRY))
      throw new Error(`通用运行入口已退役；code仅支持skill固定入口 --engine node --entry ${CLI_ENTRY}`);
    if (command === "create" && values.engine !== undefined && values.kind !== "code")
      throw new Error("只有code skill可以使用运行声明；请指定 --kind code");
  }
  if (command === "update" && values.description === undefined && values.engine === undefined)
    throw new Error("update需提供 --description 或运行声明");
  if (values.status !== undefined &&
      !["pending", "running", "succeeded", "failed", "conflict"].includes(values.status))
    throw new Error("不支持的事件状态");
  if (command === "query") {
    if (values.sql !== undefined && (values.text !== undefined || values.entry !== undefined))
      throw new Error("SQL 查询不能同时指定 --text 或 --entry");
    if (values.params !== undefined && values.sql === undefined)
      throw new Error("--params 需要同时指定 --sql");
    if (values.sql === "") throw new Error("--sql 不能为空");
  }
  if (command === "write") {
    const sources = [values.sql, values.file, values.body]
      .filter((value) => value !== undefined);
    if (sources.length !== 1)
      throw new Error("write 需指定 --sql、--file 或 --body 中的一项");
    if (values.params !== undefined && values.sql === undefined)
      throw new Error("--params 需要同时指定 --sql");
    if (values.entry !== undefined && values.body === undefined)
      throw new Error("文本入口 --entry 需要同时指定 --body");
    if (sources[0] === "") throw new Error("write 输入不能为空");
  }
  if (command === "edit" && (!values["old-text"] || values["new-text"] === undefined))
    throw new Error("edit需要--old-text与--new-text，原文不能为空，新文字可为空");
  if (command === "organize") {
    if ([values.inspect, values.plan !== undefined, values.receipt !== undefined].filter(Boolean).length !== 1)
      throw new Error("organize需要--inspect、--plan或--receipt中的一项");
    if (values["dry-run"] && values.plan === undefined) throw new Error("--dry-run需要--plan");
    if (values.plan !== undefined && !values.plan) throw new Error("--plan不能为空");
    if (values.receipt !== undefined && !values.receipt) throw new Error("--receipt不能为空");
    if (values.plan !== undefined && !values["dry-run"] && (values.offset || 0) > 0)
      throw new Error("正式提交不能通过offset翻页，请查询receipt");
  }
}
