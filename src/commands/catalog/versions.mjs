import { text, integer, version } from "./options.mjs";

export const group = {
  id: "versions", title: "版本与事件",
  commands: [
  {
    name: "history", arity: [1,1], handler: "capsule",
    options: { "limit": integer(1, 100), "offset": integer(0, 1000000) },
    help: "history 名称 [--limit 数量] [--offset 偏移]\n查询 Git 提交历史。",
  },
  {
    name: "revert", arity: [2,2], handler: "events",
    options: { "token": version, "timeout": integer(1, 86400) },
    help: "revert 名称 目标提交 --token 当前token [--timeout 秒=1800]\n加入持久回撤队列并等待终态。回撤生成新提交，超时保留事件ID，不能自动重放。",
  },
  {
    name: "event", arity: [1,1], handler: "events",
    options: {  },
    help: "event 事件ID\n查询事件的真实状态、结果或失败原因。",
  },
  {
    name: "events", arity: [0,0], handler: "events",
    options: { "status": text, "limit": integer(1, 100), "offset": integer(0, 1000000) },
    help: "events [--status 状态] [--limit 数量 --offset 偏移]\n分页查询pending/running/succeeded/failed/conflict事件。",
  },
  {
    name: "sync", arity: [1,1], handler: "sync",
    options: {  },
    help: "sync 名称\n取得服务端当前精确提交，本地有未提交修改时拒绝同步。",
  },
  ],
};
