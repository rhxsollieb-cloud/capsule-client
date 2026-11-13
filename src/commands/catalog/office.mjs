import { requiredText, version } from "./options.mjs";

export const group = {
  id: "office", title: "Office工作区",
  commands: [
  {
    name: "office-status", arity: [0,0], handler: "officeSession",
    options: {  },
    help: "office-status\n检查ONLYOFFICE配置和文档服务状态。",
  },
  {
    name: "office-open", arity: [1,2], handler: "officeSession",
    options: { "token": version },
    help: "office-open 名称 [内部路径] --token 当前token\n创建绑定原件版本的ONLYOFFICE编辑会话。返回config含短期原件票据，仅提供给当前编辑器。",
  },
  {
    name: "office-session", arity: [1,1], handler: "officeSession",
    options: {  },
    help: "office-session 会话ID\n查看Office保存、冲突、版本与恢复原件状态。",
  },
  {
    name: "office-save", arity: [1,1], handler: "officeSession",
    options: {  },
    help: "office-save 会话ID\n请求文档服务保存；查询office-session确认实际结果，不自动重放。",
  },
  {
    name: "office-recovery", arity: [2,2], handler: "officeSession",
    options: {  },
    help: "office-recovery 会话ID 本地目标文件\n下载保存失败或冲突时保留的原件，不覆盖已有目标。",
  },
  {
    name: "office-write", arity: [1,2], handler: "structuredWrite",
    options: { "file": requiredText, "token": version },
    help: "office-write 名称 [内部路径] --file 修改JSON --token 当前token\nExcel changes={cells:[{sheet,cell,value}]}；Word changes={replacements:{key:文本}}填写{{key}}模板，保留原件结构，不从预览重建。",
  },
  ],
};
