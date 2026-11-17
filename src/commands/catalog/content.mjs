import { text, flag, integer, requiredText, version } from "./options.mjs";

export const group = {
  id: "content", title: "正文与原件",
  commands: [
  {
    name: "entries", arity: [1,1], handler: "capsule",
    options: { "limit": integer(1, 100), "offset": integer(0, 1000000) },
    help: "entries 名称 [--limit 数量] [--offset 偏移]\n列出胶囊内部文件。",
  },
  {
    name: "read", arity: [1,2], handler: "capsule",
    options: { "from": integer(1, 1000000), "limit": integer(1, 10000) },
    help: "read 名称 [相对路径] [--from 行号] [--limit 行数]\n单文件直接读取自身，markdown默认README.md、code默认SKILL.md、files/database默认说明.md。支持超过1MiB的UTF-8正文；默认80行、最多10000行，实际JSON预算可能提前分页，按lines.nextLine续读并核对同一token；单行过大明确失败，不把摘录当全文写回。",
  },
  {
    name: "edit", arity: [1,2], handler: "edit",
    options: { "old-text": text, "new-text": text, "all": flag, "token": version },
    help: "edit 名称 [内部路径] --old-text 原文 --new-text 新文 --token 当前token [--all]\n省略路径编辑统一详述；显式路径编辑原生文本。完整分页读取同一版本后精确替换。0匹配失败，多匹配需要--all；不自动换token或覆盖外部修改。",
  },
  {
    name: "details", arity: [1,1], handler: "details",
    options: { "from": integer(1, 1000000), "limit": integer(1, 10000) },
    help: "details 名称 [--from 行号 --limit 行数]\n分页读取cap详述及来源。文字类复用正文，其他目录复用说明.md，单文件媒体使用顶层元数据详述。",
  },
  {
    name: "write-details", arity: [1,1], handler: "details",
    options: { "file": requiredText, "description": text, "token": version },
    help: "write-details 名称 --file UTF-8文本文件 --token 当前token [--description 简述]\n经统一详述接口保存，最多1MiB。提供简述时与详述在同一版本事务中写入。",
  },
  {
    name: "query", arity: [1,1], handler: "data",
    options: { "sql": text, "params": text, "text": text, "entry": text, "limit": integer(1, 100), "offset": integer(0, 1000000) },
    help: "query 名称 [--sql SQL --params JSON] [--text 文本 --entry 相对路径] [--limit 数量 --offset 偏移]\n通过同一接口查询SQLite或检索实际文本文件。SQLite查询只读，参数采用JSON数组或对象。",
  },
  {
    name: "write", arity: [1,1], handler: "data",
    options: { "sql": text, "params": text, "file": text, "entry": text, "body": text, "token": version },
    help: "write 名称 --token 当前token [--sql SQL --params JSON | --file statements数组文件 | --body 文本文件 --entry 相对路径]\n统一文本写入或SQLite事务写入，成功形成一次提交。",
  },
  {
    name: "get", arity: [2,3], handler: "data",
    options: {  },
    help: "get 名称 [相对路径] 目标文件\n单文件省略相对路径。流式获取原件并拒绝覆盖已有目标，数据库媒体路径使用media/文件名。",
  },
  {
    name: "put", arity: [2,3], handler: "capsule",
    options: { "token": version },
    help: "put 名称 [相对路径] 本地文件 --token 当前token\n单文件省略相对路径，目录必须指定。流式上传原件并生成提交。",
  },
  {
    name: "remove-entry", arity: [2,2], handler: "capsule",
    options: { "token": version },
    help: "remove-entry 名称 内部条目 --token 当前token\n删除内部文件并生成提交。",
  },
  {
    name: "preview", arity: [1,2], handler: "preview",
    options: {  },
    help: "preview 名称 [相对路径]\n只读提取 .docx 正文与表格、.xlsx 工作表。最大 16 MiB 原件，最多 8 张表、每表 200 行与 30 列；保留提交号与截断提示，公式不执行。",
  },
  ],
};
