import { text, flag, integer, version } from "./options.mjs";

export const group = {
  id: "mounts", title: "位置组织",
  commands: [
  {
    name: "ls", arity: [0,1], handler: "mounts",
    options: { "limit": integer(1, 100), "offset": integer(0, 1000000) },
    help: "ls [虚拟路径=/] [--limit 数量] [--offset 偏移]\n列出位置直属子项。",
  },
  {
    name: "mount", arity: [2,2], handler: "mounts",
    options: {  },
    help: "mount 名称 虚拟路径\n新增展示位置，末段等于胶囊全名。",
  },
  {
    name: "position", arity: [1,1], handler: "mounts",
    options: {  },
    help: "position 虚拟路径\n取得位置子树与其 token。",
  },
  {
    name: "move", arity: [2,2], handler: "mounts",
    options: { "token": version },
    help: "move 虚拟路径 目标路径 --token 子树token\n原子移动虚拟子树。",
  },
  {
    name: "unmount", arity: [1,1], handler: "mounts",
    options: { "token": version },
    help: "unmount 虚拟路径 --token 子树token\n卸载叶位置，保留胶囊。",
  },
  {
    name: "where", arity: [1,1], handler: "discovery",
    options: { "limit": integer(1, 100), "offset": integer(0, 1000000) },
    help: "where 名称 [--limit 数量 --offset 偏移]\n列出当前cap的全部虚拟挂载，按实体身份查询，不推断引用关系。",
  },
  {
    name: "organize", arity: [0,0], handler: "organization",
    options: { "inspect": flag, "plan": text, "receipt": text, "dry-run": flag, "limit": integer(1, 100), "offset": integer(0, 1000000) },
    help: "organize --inspect | --plan JSON文件或- [--dry-run] | --receipt ID或latest [--limit 数量 --offset 偏移]\n取得组织基线，预演或统一提交位置mount/move/unmount计划。提交结果未知先查receipt，不能自动换baseline重放。",
  },
  ],
};
