import { children, descendants, first, textContent, xmlDocument } from "./xml.mjs";
import { limits, previewError, TextBudget } from "./limits.mjs";

function paragraphText(paragraph) {
  let text = "";
  const visit = (element) => {
    if (element.name === "t") text += textContent(element);
    else if (element.name === "tab") text += "\t";
    else if (element.name === "br" || element.name === "cr") text += "\n";
    else for (const child of element.children) if (typeof child === "object") visit(child);
  };
  visit(paragraph);
  return text;
}

export function wordPreview(parts) {
  const document = xmlDocument(parts.get("word/document.xml"));
  const body = descendants(document, "body")[0];
  if (!body) throw previewError("Word 文件缺少正文");
  const budget = new TextBudget();
  const blocks = [];
  let truncated = false;
  const append = (element) => {
    if (blocks.length >= limits.blocks || budget.remaining === 0) {
      truncated = true;
      return;
    }
    if (element.name === "p") {
      const style = first(first(element, "pPr") || { children: [] }, "pStyle")?.attributes.val || "";
      const heading = /^(?:Heading|标题)\s*([1-6])$/i.exec(style);
      const text = budget.take(paragraphText(element));
      if (heading) blocks.push({ type: "heading", level: Number(heading[1]), text });
      else blocks.push({ type: "paragraph", text });
    } else if (element.name === "tbl") {
      const allRows = children(element, "tr");
      const rows = allRows.slice(0, limits.rows).map((row) => {
        const cells = children(row, "tc");
        if (cells.length > limits.columns) truncated = true;
        return cells.slice(0, limits.columns).map((cell) =>
          budget.take(descendants(cell, "p").map(paragraphText).join("\n")));
      });
      if (allRows.length > limits.rows) truncated = true;
      blocks.push({ type: "table", rows });
    } else {
      for (const child of element.children) if (typeof child === "object") append(child);
    }
  };
  for (const element of body.children) if (typeof element === "object") append(element);
  return { kind: "word", blocks, truncated: truncated || budget.truncated };
}
