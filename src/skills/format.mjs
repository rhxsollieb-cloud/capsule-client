import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { regularEntry } from "../system/paths.mjs";

export const SKILL_DOCUMENT = "SKILL.md";
export const CLI_ENTRY = "scripts/cli.mjs";
export const UI_ENTRY = "scripts/ui.mjs";

export function parseSkill(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 1024 * 1024 || text.includes("\0"))
    throw new Error("SKILL.md需为不超过1MiB的UTF-8文本");
  const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!frontmatter) throw new Error("SKILL.md需要以包含name和description的YAML frontmatter开始");
  const document = parseDocument(frontmatter[1], { schema: "core", uniqueKeys: true, strict: true });
  if (document.errors.length || document.warnings.length)
    throw new Error(`SKILL.md frontmatter无效：${[...document.errors, ...document.warnings].map((error) => error.message).join("；")}`);
  let metadata;
  try { metadata = document.toJS({ maxAliasCount: 0 }); }
  catch { throw new Error("SKILL.md frontmatter不能使用YAML别名"); }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new Error("SKILL.md frontmatter必须是字段映射");
  const name = typeof metadata.name === "string" ? metadata.name.trim() : "";
  const description = typeof metadata.description === "string" ? metadata.description.trim() : "";
  if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    throw new Error("skill name需为1–64个小写字母、数字或单个连字符分隔的名称");
  if (!description || description.length > 1024 || /[<>]/.test(description) || description.startsWith("[TODO:"))
    throw new Error("skill description需为1–1024字符的实际说明，不能包含<>或TODO占位内容");
  return { name, description };
}

export async function loadSkill(root) {
  let source;
  try { source = await regularEntry(root, SKILL_DOCUMENT); }
  catch (error) { if (error.code === "ENOENT") throw new Error("代码cap缺少SKILL.md，请先显式转换为skill"); throw error; }
  const bytes = await readFile(source);
  if (bytes.length > 1024 * 1024) throw new Error("SKILL.md超过1MiB上限");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("SKILL.md必须为有效UTF-8文本"); }
  const metadata = parseSkill(text);
  let entry;
  try { entry = await regularEntry(root, CLI_ENTRY); }
  catch (error) { if (error.code === "ENOENT") throw new Error(`skill缺少固定入口${CLI_ENTRY}`); throw error; }
  let uiEntry;
  try { uiEntry = await regularEntry(root, UI_ENTRY); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return { ...metadata, entry, ...(uiEntry ? { uiEntry } : {}) };
}
