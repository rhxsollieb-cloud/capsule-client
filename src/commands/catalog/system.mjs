import { text, flag, integer } from "./options.mjs";

export const group = {
  id: "system", title: "发现与诊断",
  commands: [
  {
    name: "activity", arity: [1, 1], handler: "activity",
    options: {},
    help: "activity 名称\n只读查询胶囊当前编辑会话、排队/处理中事件与Office状态，不注册或发送心跳。count为编辑会话数，不是人数；占用仅提示，不是排他锁，保存仍需核对原token。",
  },
  {
    name: "guide", arity: [0, 1], handler: "guide", offline: true,
    options: { from: integer(1, 1000000), limit: integer(1, 200) },
    help: "guide [data|cli|skills] [--from 行号 --limit 行数]\n离线读取随包说明。data为数据规范，cli为日常及批量操作，skills为Skill格式与本机协作。无主题列索引；默认60行、最多200行，按lines.nextLine或next续读。",
  },
  {
    name: "paths", arity: [0, 0], handler: "paths",
    options: {},
    help: "paths\n离线只读显示本机工作区、数据库、缓存、运行与skill位置，不建目录、不联网；远端原件仍通过统一API取用。",
  },
  {
    name: "health", arity: [0,0], handler: "health",
    options: {  },
    help: "health\n检查服务端协议和状态。",
  },
  {
    name: "doctor", arity: [0,0], handler: "doctor",
    options: {  },
    help: "doctor\n检查本地 Node、Git 和配置，不联网安装依赖。",
  },
  {
    name: "overview", arity: [0,0], handler: "discovery",
    options: {  },
    help: "overview\n只读取得知识库cap、类别、挂载和事件概况，不展开正文。",
  },
  {
    name: "search", arity: [0,1], handler: "discovery",
    options: { "kind": text, "query": text, "text": text, "limit": integer(1, 100), "offset": integer(0, 1000000), "scan-all": flag },
    help: "search [虚拟路径=/] [--kind 类别 --query 概要文字 --text 正文文字 --limit 数量 --offset 偏移 --scan-all]\n按虚拟范围去重查询cap，正文匹配返回来源、条目、行号与范围提示；不另建cap内部索引。total/offset/nextOffset按候选cap计数，不是全部命中数；scanned说明扫描范围，incomplete说明单cap限额及续查方式。--scan-all在页数和输出预算内自动续页，未完成时沿返回的nextOffset继续；预算不足可减小--limit或使用--out。",
  },
  ],
};
