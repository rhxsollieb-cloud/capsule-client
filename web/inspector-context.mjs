import { button, node, replace } from "./dom.mjs";

const guidance = {
  text: ["阅读与编辑", "正文与虚拟子节点共同组织知识。Markdown 默认阅读，切换编辑后可保存新版本。"],
  markdown: ["Markdown 文档", "正文、图片和音视频共同保存在这个 cap 中。第二列浏览 README.md 与自有附件。"],
  image: ["原图画布", "中央保留原图比例。右侧查看像素信息，完整原件可下载。"],
  audio: ["音频试听", "使用原生播放器试听和定位，切换内容时停止播放。"],
  video: ["视频审阅", "使用原生控件播放和定位，原件按需流式读取。"],
  excel: ["表格工作区", "中央按工作表切换并呈现单元格；可按地址修改值，完整内容保留在原件。"],
  word: ["文档阅读", "中央呈现标题、段落与表格，模板文档可填写占位字段。"],
  files: ["文件集合", "第二列展开目录和文件，所有原生内容独立归属于此 cap。"],
  code: ["代码工作区", "第二列浏览原生文件，中央编辑源码并在本地运行服务端已保存版本。"],
  database: ["SQLite 工作区", "第二列切换数据表和自有文件，中央浏览记录并保存数据修改。"],
  file: ["原生文件", "保留完整原件，通过统一接口读取与版本管理。"],
};

export class InspectorContext {
  constructor() { this.element = node("div", "inspector-context"); }
  show(cap) {
    const [title, text] = guidance[cap.kind] || guidance.file;
    const guide = node("div", "context-guide");
    guide.append(node("h3", "", title), node("p", "", text));
    this.details = node("div", "context-details");
    replace(this.element, guide, this.details);
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
}
