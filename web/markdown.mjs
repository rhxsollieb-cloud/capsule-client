import { node } from "./dom.mjs";

export function inlineMarkdown(parent, value) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let start = 0;
  for (const match of value.matchAll(pattern)) {
    parent.append(document.createTextNode(value.slice(start, match.index)));
    const text = match[0];
    if (text.startsWith("`")) parent.append(node("code", "", text.slice(1, -1)));
    else if (text.startsWith("**")) parent.append(node("strong", "", text.slice(2, -2)));
    else if (text.startsWith("*")) parent.append(node("em", "", text.slice(1, -1)));
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(text);
      if (/^https:\/\//i.test(href)) {
        const link = node("a", "", label);
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        parent.append(link);
      } else parent.append(document.createTextNode(label));
    }
    start = match.index + text.length;
  }
  parent.append(document.createTextNode(value.slice(start)));
  return parent;
}

export function markdownOutline(body) {
  let fenced = false;
  const headings = [];
  for (const line of body.split("\n")) {
    if (/^```/.test(line)) fenced = !fenced;
    const match = !fenced && /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) headings.push({ level: match[1].length, text: match[2], id: `heading-${headings.length}` });
  }
  return headings;
}

export function renderMarkdown(body) {
  const article = node("article", "markdown-body");
  const lines = body.split("\n");
  let headingIndex = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (/^```/.test(line)) {
      const language = line.slice(3).trim();
      const code = [];
      while (++index < lines.length && !/^```/.test(lines[index])) code.push(lines[index]);
      const block = node("div", "markdown-code");
      if (language) block.append(node("span", "code-language", language));
      block.append(node("pre", "", code.join("\n")));
      article.append(block);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const element = inlineMarkdown(node(`h${heading[1].length}`), heading[2]);
      element.id = `heading-${headingIndex++}`;
      article.append(element);
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { article.append(node("hr")); continue; }
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || "")) {
      const table = node("table");
      const cells = (value) => value.replace(/^\s*\||\|\s*$/g, "").split("|").map((cell) => cell.trim());
      const header = node("tr");
      for (const cell of cells(line)) header.append(inlineMarkdown(node("th"), cell));
      const head = node("thead");
      head.append(header);
      table.append(head);
      index++;
      const tbody = node("tbody");
      while (index + 1 < lines.length && lines[index + 1].includes("|")) {
        const row = node("tr");
        for (const cell of cells(lines[++index])) row.append(inlineMarkdown(node("td"), cell));
        tbody.append(row);
      }
      table.append(tbody);
      const scroll = node("div", "markdown-table");
      scroll.append(table);
      article.append(scroll);
      continue;
    }
    if (/^\s*(?:[-*+] |\d+\. )/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const list = node(ordered ? "ol" : "ul");
      do {
        list.append(inlineMarkdown(node("li"), lines[index].replace(/^\s*(?:[-*+] |\d+\. )/, "")));
        index++;
      } while (index < lines.length && /^\s*(?:[-*+] |\d+\. )/.test(lines[index]));
      index--;
      article.append(list);
      continue;
    }
    if (/^>\s?/.test(line)) { article.append(inlineMarkdown(node("blockquote"), line.replace(/^>\s?/, ""))); continue; }
    const paragraph = [line];
    while (index + 1 < lines.length && lines[index + 1].trim() && !/^(?:#{1,6}\s|```|>|[-*+] |\d+\. )/.test(lines[index + 1])) paragraph.push(lines[++index]);
    article.append(inlineMarkdown(node("p"), paragraph.join("\n")));
  }
  return article;
}
