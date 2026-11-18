import { text, flag, integer, requiredText, version } from "./options.mjs";

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
    name: "import", arity: [2,2], handler: "import",
    options: { kind: text, description: text },
    help: "import 本地目录 新cap名称 [--kind markdown|files|code --description 简述]\n一次流式归档导入全新cap并形成初始提交，不覆盖名称、不自动挂载。markdown为README.md+assets/，files为说明.md+assets/，code为完整Skill目录；不执行代码。拒绝链接、运行目录和凭据文件。使用系统或Git for Windows附带的tar；未知结果先查目标和eventId，不重放。",
  },
  {
    name: "import-batch", arity: [1,1], handler: "importBatch",
    options: { "dry-run": flag, "verify": flag },
    help: "import-batch 清单JSON文件或- [--dry-run] [--verify]\n清单每项含file或directory、name及可选kind、description、path。按顺序导入新cap并挂载，拒绝覆盖。预演核对本机源及远端可见冲突；--verify通过HEAD核对单文件原件。失败停在当前项并保留逐项回执。",
  },
  {
    name: "copy", arity: [2,2], handler: "copy",
    options: { "token": version },
    help: "copy 源名称 副本名称 --token 源token\n复制源cap已保存版本为独立的新cap；只需读取源权限，非管理员可复制只读cap后编辑副本。单文件保留扩展名，不复制历史、权限或挂载，新cap默认edit。结果未知先查目标及eventId，不重放；成功后可另用mount挂载。",
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
    name: "rename", arity: [2,2], handler: "management",
    options: { "dry-run": flag, "token": text, "mounts-token": text },
    help: "rename 旧名称或虚拟路径 新名称 --dry-run\nrename 旧名称或虚拟路径 新名称 --token 实体token --mounts-token 挂载范围token\n管理员原地重命名，同步更新全部挂载及其子路径，保留内容、历史和权限。先预演核对影响范围和阻止原因，正式执行使用预演返回的两枚token。结果未知时先核对新名称和原事件。",
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
