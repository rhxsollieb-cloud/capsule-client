import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export const TEXT_INPUT_LIMIT = 1024 * 1024;

export async function readTextInput(file, { stdin = process.stdin, maxBytes = TEXT_INPUT_LIMIT } = {}) {
  if (typeof file !== "string" || !file) throw new Error("需要UTF-8文件路径或-（标准输入）");
  let source;
  if (file === "-") source = stdin;
  else {
    const info = await stat(file);
    if (!info.isFile() || info.size > maxBytes) throw new Error(`输入需要不超过${maxBytes === TEXT_INPUT_LIMIT ? "1MiB" : `${maxBytes}字节`}的普通文件`);
    source = createReadStream(file);
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const value of source) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += chunk.length;
      if (size > maxBytes) throw new Error(`输入超过${maxBytes === TEXT_INPUT_LIMIT ? "1MiB" : `${maxBytes}字节`}上限`);
      chunks.push(chunk);
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
    if (text.includes("\0")) throw new Error("文字输入包含NUL，请使用原件put接口处理二进制");
    return text;
  } catch (error) {
    if (error instanceof TypeError) throw new Error("输入必须为有效UTF-8文本", { cause: error });
    throw error;
  } finally { if (file !== "-") source.destroy(); }
}

export async function readJsonInput(file, options) {
  const text = await readTextInput(file, options);
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch (error) { throw new Error("输入需要有效JSON：" + error.message, { cause: error }); }
}
