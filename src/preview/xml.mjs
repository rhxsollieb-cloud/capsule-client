import { SaxesParser } from "saxes";
import { limits, previewError } from "./limits.mjs";

export function xmlDocument(source) {
  if (source === undefined) throw previewError("办公文件缺少必要 XML 内容");
  const document = { name: "#document", attributes: {}, children: [] };
  const stack = [document];
  const parser = new SaxesParser({ xmlns: true });
  let nodes = 0;
  parser.on("doctype", () => { throw previewError("办公文件预览不接受 DTD"); });
  parser.on("opentag", (tag) => {
    if (++nodes > limits.xmlNodes || stack.length > limits.xmlDepth)
      throw previewError("办公文件 XML 结构超过预览上限", 413);
    const element = {
      name: tag.local,
      attributes: Object.fromEntries(Object.values(tag.attributes).map((attr) => [attr.local, attr.value])),
      children: [],
    };
    stack.at(-1).children.push(element);
    stack.push(element);
  });
  parser.on("text", (text) => stack.at(-1).children.push(text));
  parser.on("cdata", (text) => stack.at(-1).children.push(text));
  parser.on("closetag", () => stack.pop());
  try {
    parser.write(source).close();
    return document;
  } catch (error) {
    if (error.status) throw error;
    throw previewError("办公文件 XML 无效");
  }
}

export function children(element, name) {
  return element.children.filter((child) => typeof child === "object" && child.name === name);
}

export function first(element, name) {
  return children(element, name)[0];
}

export function descendants(element, name) {
  const found = [];
  const visit = (current) => {
    for (const child of current.children) {
      if (typeof child !== "object") continue;
      if (child.name === name) found.push(child);
      visit(child);
    }
  };
  visit(element);
  return found;
}

export function textContent(element) {
  return element?.children.map((child) => typeof child === "string" ? child : textContent(child)).join("") || "";
}
