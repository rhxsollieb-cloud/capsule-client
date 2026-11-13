import { text, integer, requiredText, version } from "./options.mjs";

export const group = {
  id: "capsules", title: "胶囊与身份",
  commands: [
  {
    name: "list", arity: [0,0], handler: "capsule",
    options: { "query": text, "kind": text, "limit": integer(1, 100), "offset": integer(0, 1000000) },
    help: "list [--kind 类别] [--query 文本] [--limit 数量] [--offset 偏移]\n查询胶囊概要。单文件为text/image/audio/video/excel/word/file，目录为markdown/files/database/code。",
  },
  {
    name: "create", arity: [1,1], handler: "capsule",
    options: { "description": text, "body": text, "kind": text, "engine": text, "entry": text },
    help: "create 名称 [--kind 类别=text] [--description 简介] [--body 本地文件]\n单文件直接平铺保存，markdown/files/database/code拥有目录。code自动创建SKILL.md和scripts/cli.mjs；旧--engine/--entry仅允许node/scripts/cli.mjs固定值。",
  },
  {
    name: "stat", arity: [1,1], handler: "capsule",
    options: { "commit": text },
    help: "stat 名称 [--commit 提交号]\n取得当前概要与token，或读取指定提交的历史元数据。",
  },
  {
    name: "update", arity: [1,1], handler: "capsule",
    options: { "description": text, "engine": text, "entry": text, "token": version },
    help: "update 名称 --token 当前token [--description 简介] [--engine node --entry scripts/cli.mjs]\n更新顶层元数据并形成对应提交。code仅允许skill固定Node入口。",
  },
  {
    name: "removal", arity: [1,1], handler: "management",
    options: {  },
    help: "removal 名称\n预览整个胶囊清除范围，取得当前token、mountsToken、所有挂载与阻止原因。",
  },
  {
    name: "delete", arity: [1,1], handler: "management",
    options: { "token": version, "mounts-token": requiredText, "timeout": integer(1, 86400) },
    help: "delete 名称 --token 当前token --mounts-token 挂载版本 [--timeout 秒=1800]\n清除整个胶囊及其全部挂载，加入持久事件队列并等待终态。清除后不能回撤；超时保留事件ID，不能自动重放。",
  },
  ],
};
