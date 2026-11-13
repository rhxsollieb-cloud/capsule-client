import { integer, requiredText, version } from "./options.mjs";

export const group = {
  id: "database", title: "SQLite表格",
  commands: [
  {
    name: "table", arity: [2,2], handler: "table",
    options: { "limit": integer(1, 100), "offset": integer(0, 1000000) },
    help: "table 名称 表名 [--limit 数量 --offset 偏移]\n读取SQLite表结构与记录。",
  },
  {
    name: "table-write", arity: [2,2], handler: "structuredWrite",
    options: { "file": requiredText, "token": version },
    help: "table-write 名称 表名 --file 修改JSON --token 当前token\n经统一SQLite事务写入修改数组，操作为insert/update/delete，更新和删除携完整主键key。",
  },
  ],
};
