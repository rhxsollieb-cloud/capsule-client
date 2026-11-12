import { patchDocument, PatchType, TextRun } from "docx";
import mammoth from "mammoth";
import { previewError } from "../preview/limits.mjs";

export async function patchWord(buffer, changes) {
  if (!changes || Object.keys(changes).some((key) => key !== "replacements") ||
      !changes.replacements || typeof changes.replacements !== "object" ||
      Array.isArray(changes.replacements)) throw previewError("Word 填写需要 replacements 对象", 400);
  const replacements = Object.entries(changes.replacements);
  if (!replacements.length || replacements.length > 200)
    throw previewError("Word 模板需要 1–200 项替换", 400);
  let text;
  try { ({ value: text } = await mammoth.extractRawText({ buffer })); }
  catch { throw previewError("Word 模板无法由 Mammoth 读取"); }
  const patches = Object.create(null);
  for (const [name, value] of replacements) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(name) ||
        typeof value !== "string" || value.length > 10000)
      throw previewError("模板键需要英文字母标识符，替换值需要不超过10000字符的文本", 400);
    if (!text.includes(`{{${name}}}`)) throw previewError(`模板中缺少占位符：{{${name}}}`);
    patches[name] = { type: PatchType.PARAGRAPH, children: [new TextRun(value)] };
  }
  try {
    return await patchDocument({ outputType: "nodebuffer", data: buffer, keepOriginalStyles: true, patches });
  } catch { throw previewError("Word 模板无法由 docx 写回"); }
}
