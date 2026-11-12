import { action, contentUrl } from "./api.mjs";
import { button, fileKind, node, replace, shortCommit, sizeLabel, timeLabel } from "./dom.mjs";
import { icon } from "./icons.mjs";

export function emptyView(container, onCreate) {
  const empty = node("div", "empty-state");
  empty.append(icon("capsule", "empty-icon"), node("h1", "", "打开一个 cap"), node("p", "muted", "从左侧选择内容，或创建新的知识节点。"), button("新建 cap", onCreate, "button primary"));
  const shortcuts = node("div", "empty-shortcuts");
  shortcuts.append(node("span", "muted", "搜索知识库"), node("kbd", "", "⌘ K"), node("span", "muted", "保存修改"), node("kbd", "", "⌘ S"));
  empty.append(shortcuts);
  replace(container, empty);
}

export function filesView(container, _cap, result, onOpen, onMore) {
  const wrapper = node("div", "files-view");
  const heading = node("div", "file-toolbar");
  heading.append(node("strong", "", "原生文件"), node("span", "muted", `${result.total ?? result.items.length} 个文件`));
  const list = node("div", "file-list");
  if (!result.items.length) list.append(node("p", "muted file-empty", "还没有文件，可上传内容到此 cap。"));
  for (const file of result.items) {
    const row = button("", () => onOpen(file.path), "file-row");
    row.append(icon(fileKind(file.path)), node("span", "file-name mono", file.path), node("span", "file-size muted", sizeLabel(file.size)));
    list.append(row);
  }
  wrapper.append(heading, list);
  if (result.nextOffset !== null && result.nextOffset !== undefined)
    wrapper.append(button("加载更多", () => onMore(result.nextOffset), "button ghost"));
  replace(container, wrapper);
}

export function mediaView(container, cap, entry) {
  const name = entry || cap.name;
  const kind = fileKind(name, entry ? "file" : cap.kind);
  const wrapper = node("div", "media-preview");
  const element = node(kind === "image" ? "img" : kind);
  element.src = contentUrl(cap.name, entry);
  if (kind === "image") element.alt = name;
  else {
    element.controls = true;
    element.preload = "metadata";
  }
  const error = node("p", "error-message hidden", "当前原件无法预览，可下载后查看或上传新的原件。");
  element.addEventListener("error", () => error.classList.remove("hidden"));
  wrapper.append(element, error, downloadButton(cap.name, entry));
  replace(container, wrapper);
}

export function downloadButton(name, entry) {
  const link = node("a", "button secondary", "下载原件");
  link.href = contentUrl(name, entry, true);
  link.download = entry?.split("/").at(-1) || name;
  link.prepend(icon("download"));
  return link;
}

export function fileView(container, cap, entry, detail = "此格式可下载原件查看。") {
  const card = node("div", "file-card empty-state");
  card.append(icon(fileKind(entry || cap.name, cap.kind), "empty-icon"), node("h2", "", entry || cap.name), node("p", "muted", detail), downloadButton(cap.name, entry));
  replace(container, card);
}

export async function historyView(container, cap, isCurrent, onRevert, onError) {
  replace(container, node("p", "loading", "正在读取版本历史…"));
  try {
    const result = await action("history", { name: cap.name, limit: 50 });
    if (!isCurrent()) return;
    const wrapper = node("div", "history-view");
    const heading = node("div", "file-toolbar");
    heading.append(node("strong", "", "版本历史"), node("span", "muted", "回撤会生成新的提交"));
    wrapper.append(heading);
    const append = (items) => {
      for (const item of items) {
        const row = node("div", "history-row");
        const info = node("div", "history-info");
        const commit = node("span", "mono commit-value", shortCommit(item.commit));
        commit.title = item.commit;
        info.append(commit, node("strong", "", item.message), node("span", "muted", item.description || ""), node("time", "muted", timeLabel(item.createdAt)));
        const restore = button(item.commit === cap.commit ? "当前版本" : "回撤", () => onRevert(item));
        restore.disabled = item.commit === cap.commit;
        row.append(info, restore);
        wrapper.append(row);
      }
    };
    append(result.items);
    let offset = result.nextOffset;
    const more = button("加载更多", async () => {
      more.disabled = true;
      try {
        const next = await action("history", { name: cap.name, limit: 50, offset });
        if (!isCurrent()) return;
        more.remove();
        append(next.items);
        offset = next.nextOffset;
        if (offset !== null && offset !== undefined) wrapper.append(more);
      } catch (error) { onError(error); }
      finally { more.disabled = false; }
    }, "button ghost");
    if (offset !== null && offset !== undefined) wrapper.append(more);
    replace(container, wrapper);
  } catch (error) {
    if (isCurrent()) replace(container, node("p", "error-message file-empty", error.message));
    onError(error);
  }
}
