import { action } from "./api.mjs";
import { button, directoryKinds, fileKind, node, replace } from "./dom.mjs";
import { icon } from "./icons.mjs";

const guidance = {
  text: ["阅读与编辑", "正文与虚拟子节点共同组织知识。Markdown 默认阅读，切换编辑后可保存新版本。"],
  image: ["原图画布", "中央保留原图比例。右侧查看像素信息，完整原件可下载。"],
  audio: ["音频试听", "使用原生播放器试听和定位，切换内容时停止播放。"],
  video: ["视频审阅", "使用原生控件播放和定位，原件按需流式读取。"],
  excel: ["表格预览", "中央按工作表切换并呈现单元格；公式不执行，完整内容保留在原件。"],
  word: ["文档阅读", "中央按纸张呈现标题、段落与表格，下载原件查看完整排版。"],
  files: ["文件集合", "从中央文件列表或侧边条目进入，所有文件独立归属于此 cap。"],
  code: ["代码工作区", "浏览原生文件并编辑源码。运行时同步服务端当前提交，在本地执行。"],
  database: ["SQLite 工作区", "从数据表进入记录，展开 SQL 可自定义只读查询。媒体由此 cap 独立保存。"],
  file: ["原生文件", "保留完整原件，通过统一接口读取与版本管理。"],
};

export class InspectorContext {
  constructor({ onOpenEntry, onOpenTable }) {
    Object.assign(this, { onOpenEntry, onOpenTable });
    this.element = node("div", "inspector-context");
    this.request = 0;
  }
  show(cap) {
    this.cap = cap;
    const [title, text] = guidance[cap.kind] || guidance.file;
    const guide = node("div", "context-guide");
    guide.append(node("h3", "", title), node("p", "", text));
    this.details = node("div", "context-details");
    this.navigation = node("div", "context-navigation");
    replace(this.element, guide, this.details, this.navigation);
    this.loadNavigation(cap);
  }
  context({ label, values = [], headings = [] }) {
    const content = node("div", "context-section");
    content.append(node("h3", "", label));
    for (const value of values) content.append(node("p", "context-value", value));
    for (const heading of headings) {
      const link = button(heading.text, () => document.getElementById(heading.id)?.scrollIntoView({ behavior: "smooth", block: "start" }), `outline-link outline-level-${heading.level}`);
      content.append(link);
    }
    replace(this.details, content);
  }
  async loadNavigation(cap) {
    const request = ++this.request;
    if (!directoryKinds.has(cap.kind)) return;
    try {
      const result = cap.kind === "database"
        ? await action("query", { name: cap.name, sql: "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", limit: 50 })
        : await action("entries", { name: cap.name, limit: 50 });
      if (request !== this.request || this.cap?.name !== cap.name) return;
      const section = node("div", "context-section");
      section.append(node("h3", "", cap.kind === "database" ? "数据表" : "原生文件"));
      for (const item of result.items) {
        const name = cap.kind === "database" ? item.name : item.path;
        const control = button("", () => cap.kind === "database" ? this.onOpenTable(name) : this.onOpenEntry(name), "context-entry");
        control.append(icon(cap.kind === "database" ? "excel" : fileKind(name), `kind-${fileKind(name)}`), node("span", "", name));
        section.append(control);
      }
      if (!result.items.length) section.append(node("p", "", "暂无条目"));
      if (result.nextOffset !== null && result.nextOffset !== undefined) section.append(node("p", "property-note", "此处显示前 50 项，更多内容从中央浏览。"));
      replace(this.navigation, section);
    } catch (error) {
      if (request === this.request) replace(this.navigation, node("p", "property-note error-message", error.message));
    }
  }
}
