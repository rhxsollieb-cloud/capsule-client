import { text, version } from "./options.mjs";

export const group = {
  id: "skills", title: "本机Skill",
  commands: [
  {
    name: "run", arity: [1,1], handler: "run",
    options: { "log-cap": text },
    help: "run 名称 [--log-cap 数据库胶囊] -- [传给skill CLI的参数]\n同步code skill精确提交，从scripts/cli.mjs独立Node入口运行。CAPSULE_SKILL_STATE指向按服务端与cap隔离的持久本机状态，CAPSULE_TOKEN不传给skill；依赖按SKILL.md自行准备，客户端不自动安装。日志失败保留实际结果并非零退出。",
  },
  {
    name: "skill-register", arity: [1,1], handler: "skills",
    options: {  },
    help: "skill-register 名称\n经本机客户端服务同步并注册skill，核对SKILL.md和固定入口；与界面使用同一份本机登记。",
  },
  {
    name: "skill-status", arity: [1,1], handler: "skills",
    options: {  },
    help: "skill-status 名称\n查询本机登记与页面状态。latestHasUI 表示服务端当前提交提供前端，running 的 session.url 可在本机打开；在工作台选中节点即可嵌入右侧。",
  },
  {
    name: "skill-start", arity: [1,1], handler: "skills",
    options: {  },
    help: "skill-start 名称\n经本机工作台启动或复用 scripts/ui.mjs，回执包含 session.url。选中有前端的节点也会自动打开；纯 CLI 节点展示 SKILL.md。",
  },
  {
    name: "skill-stop", arity: [1,1], handler: "skills",
    options: {  },
    help: "skill-stop 名称\n经本机客户端服务停止当前skill界面及其进程组。",
  },
  {
    name: "convert-skill", arity: [1,1], handler: "capsule",
    options: { "token": version },
    help: "convert-skill 名称 --token 当前token\n显式将旧code入口整理为SKILL.md及固定scripts/cli.mjs并生成新版本；已有文件不覆盖。",
  },
  ],
};
