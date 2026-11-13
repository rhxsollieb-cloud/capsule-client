export function node(tag, className = "", text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

export function button(text, handler, className = "button secondary") {
  const element = node("button", className, text);
  element.type = "button";
  if (handler) element.addEventListener("click", handler);
  return element;
}

export function replace(element, ...children) {
  for (const media of element.querySelectorAll("audio, video")) {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }
  element.replaceChildren(...children.filter(Boolean));
}

export const directoryKinds = new Set(["files", "database", "code", "markdown"]);
export const kindLabels = {
  text: "文本", image: "图片", audio: "音频", video: "视频", excel: "Excel",
  word: "Word", file: "文件", files: "文件集合", database: "SQLite 数据库", code: "Skill", markdown: "Markdown · 正文与附件",
};

export function fileKind(name, kind = "file") {
  if (["image", "audio", "video", "excel", "word", "text"].includes(kind)) return kind;
  const extension = name.split(".").at(-1).toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(extension)) return "image";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(extension)) return "audio";
  if (["mp4", "webm", "mov", "m4v"].includes(extension)) return "video";
  if (["xls", "xlsx"].includes(extension)) return "excel";
  if (["doc", "docx", "pdf"].includes(extension)) return "word";
  if (["sqlite", "db", "zip", "exe", "bin", "pptx", "ppt"].includes(extension)) return "file";
  return "text";
}

export function sizeLabel(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function timeLabel(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function shortCommit(value) {
  return value?.slice(0, 8) || "—";
}

export function formField(label, control) {
  const field = node("label", "field");
  field.append(node("span", "property-label", label), control);
  return field;
}
