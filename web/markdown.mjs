import { markdownit, DOMPurify } from "./vendor/markdown.mjs";
import { contentUrl } from "./api.mjs";
import { node } from "./dom.mjs";
import { capsuleEntry, embeddedKind } from "./markdown-paths.mjs";
import { exceedsMarkdownBudget, exceedsMarkdownBytes } from "./markdown-budget.mjs";

const parser = markdownit({ html: true, linkify: false, typographer: false });
const safeHtml = (source) => DOMPurify.sanitize(source, {
  ALLOWED_TAGS: ["table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "br", "a"],
  ALLOWED_ATTR: ["id", "colspan", "rowspan", "scope"],
  ALLOW_DATA_ATTR: false,
});
parser.renderer.rules.html_block = (tokens, index) => safeHtml(tokens[index].content);
parser.renderer.rules.html_inline = (tokens, index) => safeHtml(tokens[index].content);
parser.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  const source = parser.utils.escapeHtml(token.attrGet("src") || "");
  const label = parser.utils.escapeHtml(token.content || "附件");
  return `<span class="markdown-attachment" data-cap-media="${source}">${label}</span>`;
};

function headings(tokens) {
  const outline = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;
    const item = { level: Number(token.tag.slice(1)), text: tokens[index + 1]?.content || "", id: `heading-${outline.length}` };
    token.attrSet("id", item.id);
    outline.push(item);
  }
  return outline;
}

export function markdownOutline(body) {
  if (exceedsMarkdownBytes(body)) return [];
  const tokens = parser.parse(body, {});
  return exceedsMarkdownBudget(tokens) ? [] : headings(tokens);
}

function mediaAttachment(placeholder, { name, entry, token }) {
  const source = placeholder.dataset.capMedia;
  const path = name ? capsuleEntry(source, entry) : null;
  const kind = path && embeddedKind(path);
  if (!kind) {
    placeholder.textContent = `${placeholder.textContent}（媒体需位于当前 cap 内）`;
    placeholder.removeAttribute("data-cap-media");
    return;
  }
  const media = node(kind === "image" ? "img" : kind, `markdown-media markdown-${kind}`);
  if (kind === "image") {
    media.alt = placeholder.textContent;
    media.loading = "lazy";
  } else {
    media.controls = true;
    media.preload = "metadata";
  }
  media.src = contentUrl(name, path, false, { token });
  const figure = node("span", "markdown-media-frame");
  const caption = node("span", "markdown-media-caption", placeholder.textContent);
  media.addEventListener("error", () => {
    caption.textContent = `${placeholder.textContent}（附件暂时无法加载，请刷新内容后重试）`;
    caption.classList.add("error-message");
  });
  figure.append(media, caption);
  placeholder.replaceWith(figure);
}

function localLink(link, { name, entry, onOpenEntry, onAnchor }, article) {
  const href = link.getAttribute("href") || "";
  if (/^https:\/\//i.test(href)) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return;
  }
  if (href.startsWith("#")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      let id = href.slice(1);
      try { id = decodeURIComponent(id); } catch { /* Invalid escapes remain literal anchor IDs. */ }
      const target = [...article.querySelectorAll("[id]")].find((element) => element.id === id);
      if (target) target.scrollIntoView({ block: "start" });
      else onAnchor?.(id);
    });
    return;
  }
  const path = name ? capsuleEntry(href, entry) : null;
  if (!path) { link.removeAttribute("href"); return; }
  link.href = contentUrl(name, path, true);
  if (onOpenEntry) link.addEventListener("click", (event) => { event.preventDefault(); onOpenEntry(path); });
}

export function renderMarkdown(body, context = {}) {
  const tokens = exceedsMarkdownBytes(body) ? null : parser.parse(body, {});
  const article = node("article", "markdown-body");
  if (!tokens || exceedsMarkdownBudget(tokens)) {
    const message = node("p", "markdown-limit", "此段结构过于复杂，已停止渲染。请缩小阅读范围，或下载原件查看。");
    message.setAttribute("role", "status");
    article.append(message);
    return article;
  }
  headings(tokens);
  const fragment = DOMPurify.sanitize(parser.renderer.render(tokens, parser.options, {}), {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true },
    ADD_ATTR: ["data-cap-media"],
    FORBID_TAGS: ["style", "svg", "math", "iframe", "object", "embed", "form", "input"],
  });
  article.append(fragment);
  for (const placeholder of article.querySelectorAll("[data-cap-media]")) mediaAttachment(placeholder, context);
  for (const link of article.querySelectorAll("a")) localLink(link, context, article);
  for (const table of article.querySelectorAll("table")) {
    const scroll = node("div", "markdown-table");
    table.replaceWith(scroll);
    scroll.append(table);
  }
  return article;
}
