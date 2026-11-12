const usage = {
  health: "health\n检查服务端协议和状态。",
  list: "list [--kind 类别] [--query 文本] [--limit 数量] [--offset 偏移]\n查询胶囊概要。类别为 text、code、database、file、media。",
  ls: "ls [虚拟路径=/] [--limit 数量] [--offset 偏移]\n列出位置直属子项。",
  create: "create 名称 [--kind 类别] [--description 简介] [--body 本地文件] [--engine node --entry 入口]\n创建独立胶囊和初始提交。database创建SQLite业务库与自有媒体区，日志写数据库。省略类别时，有runtime推断code，否则text。",
  stat: "stat 名称\n取得概要、完整提交号与当前写入 token。",
  entries: "entries 名称 [--limit 数量] [--offset 偏移]\n列出胶囊内部文件。",
  read: "read 名称 [内部条目=说明.md] [--from 行号] [--limit 行数]\n分段读取 UTF-8 文本。",
  query: "query 名称 [--sql SQL --params JSON] [--text 文本 --entry 相对路径] [--limit 数量 --offset 偏移]\n通过同一接口查询SQLite或检索实际文本文件。SQLite查询只读，参数采用JSON数组或对象。",
  write: "write 名称 --token 当前token [--sql SQL --params JSON | --file statements数组文件 | --body 文本文件 --entry 相对路径]\n统一文本写入或SQLite事务写入，成功形成一次提交。",
  get: "get 名称 内部条目 目标文件\n流式获取原件，失败不留下半份目标且拒绝覆盖已有目标。数据库媒体路径使用 media/文件名。",
  put: "put 名称 内部条目 本地文件 --token 当前token\n流式上传原件并生成提交。旧 token 返回冲突。",
  "remove-entry": "remove-entry 名称 内部条目 --token 当前token\n删除内部文件并生成提交。",
  mount: "mount 名称 虚拟路径\n新增展示位置，末段等于胶囊全名。",
  position: "position 虚拟路径\n取得位置子树与其 token。",
  move: "move 虚拟路径 目标路径 --token 子树token\n原子移动虚拟子树。",
  unmount: "unmount 虚拟路径 --token 子树token\n卸载叶位置，保留胶囊。",
  history: "history 名称 [--limit 数量] [--offset 偏移]\n查询 Git 提交历史。",
  sync: "sync 名称\n取得服务端当前精确提交，本地有未提交修改时拒绝同步。",
  run: "run 名称 [--log-cap 数据库胶囊] -- [传给工具的参数]\n运行code类别的精确提交，结果写本地runs.sqlite。可选--log-cap经统一事务接口写cap_run_logs，日志失败保留实际结果并返回非零。第三方依赖尚不支持。",
  doctor: "doctor\n检查本地 Node、Git 和配置，不联网安装依赖。",
};

export function help(command) {
  if (command) {
    if (!usage[command]) throw new Error("未知命令：" + command);
    return "capsule " + usage[command] + "\n";
  }
  return `用法：capsule 命令 [参数]

${Object.keys(usage).join("  ")}

使用 capsule help 命令 查看具体帮助。
配置 CAPSULE_SERVER_URL、CAPSULE_TOKEN、CAPSULE_CLIENT_HOME。
`;
}
