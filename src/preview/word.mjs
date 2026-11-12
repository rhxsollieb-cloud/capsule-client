import mammoth from "mammoth";
import { parseFragment } from "parse5";
import { limits, previewError, TextBudget } from "./limits.mjs";

function text(element) {
  if (element.nodeName === "#text") return element.value;
  if (element.nodeName === "br") return "\n";
  return (element.childNodes || []).map(text).join("");
}

function descendants(element, tag) {
  return (element.childNodes || []).flatMap((child) => child.tagName === tag ? [child] : descendants(child, tag));
}

export async function wordPreview(buffer) {
  let converted;
  try {
    converted = await mammoth.convertToHtml({ buffer }, {
      externalFileAccess: false,
      includeEmbeddedStyleMap: false,
      ignoreEmptyParagraphs: false,
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })),
    });
  } catch {
    throw previewError("Word 文件无法由 Mammoth 读取");
  }
  const document = parseFragment(converted.value);
  const budget = new TextBudget();
  const blocks = [];
  let truncated = false;
  const append = (element) => {
    if (blocks.length >= limits.blocks || budget.remaining === 0) { truncated = true; return; }
    const heading = /^h([1-6])$/.exec(element.tagName || "");
    if (element.tagName === "table") {
      const allRows = descendants(element, "tr");
      const rows = allRows.slice(0, limits.rows).map((row) => {
        const cells = (row.childNodes || []).filter((child) => ["td", "th"].includes(child.tagName));
        if (cells.length > limits.columns) truncated = true;
        return cells.slice(0, limits.columns).map((cell) => budget.take(text(cell)));
      });
      if (allRows.length > limits.rows) truncated = true;
      blocks.push({ type: "table", rows });
    } else if (heading) blocks.push({ type: "heading", level: Number(heading[1]), text: budget.take(text(element)) });
    else if (["p", "li"].includes(element.tagName)) blocks.push({ type: "paragraph", text: budget.take(text(element)) });
    else for (const child of element.childNodes || []) if (child.tagName) append(child);
  };
  for (const child of document.childNodes) append(child);
  return { kind: "word", blocks, truncated: truncated || budget.truncated };
}
