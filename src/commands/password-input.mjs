import { createInterface } from "node:readline/promises";
import { StringDecoder } from "node:string_decoder";
import { readTextInput } from "./input.mjs";

export async function passwordInput(file, { stdin = process.stdin, stderr = process.stderr } = {}, prompt = "密码：") {
  if (file !== undefined) {
    const value = (await readTextInput(file, { stdin, maxBytes: 4096 })).replace(/^\uFEFF/u, "").replace(/\r?\n$/u, "");
    if (!value || /[\r\n]/u.test(value)) throw new Error("密码文件需要一行非空 UTF-8 密码");
    return value;
  }
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") throw new Error("非交互模式需要 --password-file（- 表示标准输入），不要把密码放入命令参数");
  stderr.write(prompt);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true); stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const decoder = new StringDecoder("utf8");
    let escape = 0;
    let completed = false;
    const finish = (error) => {
      if (completed) return;
      completed = true;
      stdin.off("data", read); stdin.off("error", failed); stdin.off("end", ended);
      stdin.setRawMode(Boolean(wasRaw)); stdin.pause(); stderr.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const failed = (error) => finish(error);
    const ended = () => finish(new Error("密码输入已关闭"));
    const read = (chunk) => {
      for (const character of typeof chunk === "string" ? chunk : decoder.write(chunk)) {
        if (character === "\u001b") { escape = 1; continue; }
        if (escape === 1) {
          if (character === "[" || character === "O") { escape = 2; continue; }
          return finish(new Error("密码输入不支持该终端控制序列，请使用普通输入或密码文件"));
        }
        if (escape === 2) {
          if (character >= "@" && character <= "~") escape = 0;
          else if (!/[0-9;?]/u.test(character)) return finish(new Error("密码输入中的终端控制序列无效"));
          continue;
        }
        if (character === "\u0003" || character === "\u0004") return finish(new Error("已取消密码输入"));
        if (character === "\r" || character === "\n") return finish(value ? undefined : new Error("密码不能为空"));
        if (character === "\u007f" || character === "\b") { value = [...value].slice(0, -1).join(""); continue; }
        if (character >= " ") value += character;
        if (value.length > 256) return finish(new Error("密码超过 256 字符"));
      }
    };
    stdin.on("data", read); stdin.once("error", failed); stdin.once("end", ended);
  });
}

export async function usernameInput(value, { stdin = process.stdin, stderr = process.stderr } = {}) {
  if (value) return value;
  if (!stdin.isTTY) throw new Error("非交互模式需要提供用户名");
  const readline = createInterface({ input: stdin, output: stderr });
  try { return (await readline.question("用户名：")).trim(); }
  finally { readline.close(); }
}
