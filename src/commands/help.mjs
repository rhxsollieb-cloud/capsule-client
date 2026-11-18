import { commands, commandDefinition, groups, optionDefinitions } from "./catalog.mjs";

const notes = "通用输出：--fields 字段列表；--max-chars 512..200000（默认12000）；--out JSON文件（拒绝覆盖）；--json-errors 输出机器错误。read/details/guide主题正文另支持--raw。\n正文与JSON输入的文件参数接受-，从标准输入有界读取。实体token与位置子树token分别使用；超时先查事件或组织回执，不自动重放。cap内容写入可用--lease或CAPSULE_LEASE_TOKEN携编辑占用凭证；租约不代替原token，20秒到期、每5秒续租，完成后立即释放。";

function machineCommand(command) {
  return { name: command.name, group: command.group, arity: command.arity, ...(command.offline ? { offline: true } : {}), options: optionDefinitions(command.name), help: command.help };
}

export function help(topic, { json = false } = {}) {
  if (topic && Object.hasOwn(commands, topic)) {
    const command = commandDefinition(topic);
    return json ? JSON.stringify(machineCommand(command), null, 2) + "\n" : `capsule ${command.help}\n${notes}\n`;
  }
  const group = groups.find((item) => item.id === topic);
  if (topic && !group) throw new Error("未知命令或帮助组：" + topic);
  if (json) return JSON.stringify(group
    ? { group: group.id, title: group.title, commands: group.commands.map((item) => machineCommand(commandDefinition(item.name))) }
    : { name: "capsule", helpVersion: 1, groups: groups.map((item) => ({ id: item.id, title: item.title, commands: item.commands.map((command) => ({ name: command.name, summary: command.help.split("\n")[1] })) })) }, null, 2) + "\n";
  const lines = (group ? [group] : groups).map((item) => `  ${item.id.padEnd(10)} ${item.title}\n    ${item.commands.map((command) => command.name).join("  ")}`);
  return `用法：capsule 命令 [参数]\n\n${lines.join("\n\n")}\n\n使用 capsule help 组或命令 查看分层帮助；追加--json取得机器声明。\n首次连接使用 capsule connection 和 capsule login，capsule me 核对身份。\n${notes}\n`;
}
