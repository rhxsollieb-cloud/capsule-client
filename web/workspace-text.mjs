import { action, readDetails } from "./api.mjs";
import { markdownOutline } from "./markdown.mjs";
import { PagedTextReader } from "./reader.mjs";
import { checkedReadPage } from "./read-record.mjs";

function updateCap(workspace, record) {
  workspace.cap = { ...workspace.cap, description: record.description ?? workspace.cap.description,
    runtime: record.runtime, commit: record.commit, token: record.token,
    ...(record.permissions ? { permissions: record.permissions } : {}) };
}

function openEditor(workspace, entry, record) {
  updateCap(workspace, record);
  workspace.editor.open(workspace.content, workspace.cap, entry, {
    ...record, saveAction: workspace.detailsMode ? "save-details" : "save",
  });
  workspace.editingContent = { name: workspace.cap.name, entry, details: workspace.detailsMode };
  workspace.inspector.context({ label: /\.md$/i.test(entry || workspace.cap.name) ? "正文大纲" : "文件内容",
    headings: markdownOutline(record.body), values: [`${record.body.split("\n").length} 行 · ${record.body.length.toLocaleString()} 字符`], entry });
  workspace.displayedCommit = record.commit;
  workspace.chrome();
}

export async function loadWorkspaceText(workspace, { cap, entry, isCurrent, background, signal }) {
  let record = workspace.detailsMode ? await readDetails(cap.name, isCurrent, { signal })
    : await action("read", { name: cap.name, ...(entry === undefined ? {} : { entry }), from: 1, limit: 240 }, { signal });
  if (!record || !isCurrent()) return;
  if (background && workspace.editor.hasDirty(cap.name, entry)) { workspace.editor.markRemote(cap.name, entry); return; }
  checkedReadPage(record, { from: 1 });
  updateCap(workspace, record);
  const draft = workspace.editor.drafts.get(workspace.editor.key(cap.name, entry));
  if (draft?.dirty || draft?.saving) {
    const total = draft.body.split("\n").length;
    record = { ...record, body: draft.body, lines: { from: 1, to: total, total, nextLine: null, truncated: false } };
  } else if (!workspace.detailsMode && (record.lines.truncated || new TextEncoder().encode(JSON.stringify({ body: record.body })).length > 1024 * 1024 - 8192)) {
    workspace.reader = new PagedTextReader(workspace.content, workspace.cap, entry, {
      initial: record, isCurrent, onError: workspace.onError,
      markdown: cap.kind === "markdown" && !entry || /\.md$/i.test(entry || cap.name),
      onOpenEntry: (value) => workspace.openFile(value),
      onRead: (page) => {
        if (!isCurrent()) return;
        if (page) workspace.inspector.context({ label: "当前阅读段落", headings: markdownOutline(page.body),
          values: [`第 ${page.lines.from}–${page.lines.to} 行 / 共 ${page.lines.total} 行`], entry });
        workspace.chrome();
      },
      onFullEdit: async (complete) => {
        if (!isCurrent()) return;
        workspace.reader.destroy(); workspace.reader = null;
        openEditor(workspace, entry, complete);
        await workspace.editor.current.switchMode("edit");
      },
    });
    await workspace.reader.ready;
    if (isCurrent()) { workspace.displayedCommit = record.commit; workspace.chrome(); }
    return;
  }
  openEditor(workspace, entry, record);
}
