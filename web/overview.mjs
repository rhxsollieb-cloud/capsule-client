import { action } from "./api.mjs";
import { button, directoryKinds, kindLabels, node, replace, shortCommit } from "./dom.mjs";
import { icon } from "./icons.mjs";

export async function overviewView(container, onOpen, onCreate, isCurrent) {
  replace(container, node("p", "loading", "正在读取知识库…"));
  try {
    const result = await action("list", { limit: 50 });
    if (!isCurrent()) return;
    const page = node("div", "library-overview");
    const hero = node("div", "overview-heading");
    const text = node("div");
    text.append(node("span", "content-eyebrow", "YOUR KNOWLEDGE, CONNECTED"), node("h1", "", "知识，各就其位。"), node("p", "", "从虚拟路径进入主题，在同一工作台阅读文档、查看媒体、查询数据与运行工具。"));
    const count = node("div", "overview-count");
    count.append(node("strong", "", result.total ?? result.items.length), node("span", "", "个 cap"));
    hero.append(text, count);
    page.append(hero);
    for (const [title, directory] of [["内容", false], ["工作容器", true]]) {
      const items = result.items.filter((item) => directoryKinds.has(item.kind) === directory);
      if (!items.length) continue;
      const heading = node("div", "section-heading");
      heading.append(node("h2", "", title), node("span", "muted", `${items.length} 项`));
      const grid = node("div", "cap-grid");
      for (const item of items) {
        const card = button("", () => onOpen(item), `cap-card kind-${item.kind}`);
        const top = node("div", "cap-card-top");
        top.append(icon(item.kind, "cap-card-icon"), node("span", "type-badge", kindLabels[item.kind] || item.kind));
        card.append(top, node("h3", "", item.name), node("p", "", item.description || "打开查看内容"), node("span", "card-version mono", shortCommit(item.commit)));
        grid.append(card);
      }
      page.append(heading, grid);
    }
    if (!result.items.length) page.append(node("p", "", "知识库还是空的，创建一个 cap 开始整理。"), button("创建第一个 cap", onCreate, "button primary"));
    if (result.nextOffset !== null && result.nextOffset !== undefined) page.append(node("p", "range-notice", "概览显示前 50 项，可从左侧全部 cap 分页浏览。"));
    replace(container, page);
  } catch (error) {
    if (isCurrent()) replace(container, node("p", "error-message", error.message));
  }
}
