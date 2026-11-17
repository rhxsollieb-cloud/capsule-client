import { text } from "./options.mjs";

const command = (name, arity, options, help) => ({ name, arity, options, help, handler: "auth", offline: true });
export const group = {
  id: "auth", title: "连接与用户名密码登录",
  commands: [
    command("connection", [0, 1], { "office-url": text }, "connection [服务端根地址] [--office-url Docs根地址]\n读取或保存当前员工的本机连接，不含密码或令牌；更换服务端需重新登录。远程登录要求 HTTPS。"),
    command("login", [0, 1], { server: text, "office-url": text, "password-file": text }, "login [用户名] [--server HTTPS地址 --office-url Docs地址 --password-file UTF-8文件或-]\n人与Agent使用相同帐密登录并复用本机会话；交互隐藏密码，非交互从受保护文件或stdin读取，不保存密码。显式CAPSULE_TOKEN仅作兼容维护入口并优先。"),
    command("logout", [0, 0], {}, "logout\n撤销并移除本机保存的登录会话，不撤销兼容维护令牌；网络失败保留当前配置以便核对。"),
    command("password-change", [0, 0], { "current-password-file": text, "new-password-file": text }, "password-change [--current-password-file 当前密码文件 --new-password-file 新密码文件]\n修改本人密码并退出该账户全部登录会话；未给文件时隐藏交互输入，不通过明文argv传密码，兼容维护令牌保留。"),
  ],
};
