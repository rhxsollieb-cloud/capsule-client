export const kinds = [
  "text", "image", "audio", "video", "excel", "word", "file",
  "files", "database", "code",
];

export const options = {
  health: [],
  list: ["query", "kind", "limit", "offset"],
  ls: ["limit", "offset"],
  create: ["description", "body", "kind", "engine", "entry"],
  stat: ["commit"],
  update: ["description", "engine", "entry", "token"],
  entries: ["limit", "offset"],
  read: ["from", "limit"],
  preview: [],
  query: ["sql", "params", "text", "entry", "limit", "offset"],
  write: ["sql", "params", "file", "entry", "body", "token"],
  get: [],
  put: ["token"],
  "remove-entry": ["token"],
  mount: [],
  position: [],
  move: ["token"],
  unmount: ["token"],
  history: ["limit", "offset"],
  revert: ["token", "timeout"],
  event: [],
  events: ["status", "limit", "offset"],
  sync: [],
  run: ["log-cap"],
  doctor: [],
};

export const arity = {
  health: [0, 0],
  list: [0, 0],
  ls: [0, 1],
  create: [1, 1],
  stat: [1, 1],
  update: [1, 1],
  entries: [1, 1],
  read: [1, 2],
  preview: [1, 2],
  query: [1, 1],
  write: [1, 1],
  get: [2, 3],
  put: [2, 3],
  "remove-entry": [2, 2],
  mount: [2, 2],
  position: [1, 1],
  move: [2, 2],
  unmount: [1, 1],
  history: [1, 1],
  revert: [2, 2],
  event: [1, 1],
  events: [0, 0],
  sync: [1, 1],
  run: [1, 1],
  doctor: [0, 0],
};

export function validateValues(command, values) {
  if (values.kind !== undefined && !kinds.includes(values.kind))
    throw new Error("类别需为 " + kinds.join("、"));
  if (
    ["put", "remove-entry", "move", "unmount", "write", "update", "revert"].includes(command) &&
    !values.token
  )
    throw new Error("写入需要 --token，请先读取当前实体或位置版本");
  if (["create", "update"].includes(command)) {
    if (Boolean(values.engine) !== Boolean(values.entry))
      throw new Error("运行配置需同时提供 --engine 和 --entry");
    if (values.engine !== undefined && values.engine !== "node")
      throw new Error("当前仅支持 node 运行环境");
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
}
