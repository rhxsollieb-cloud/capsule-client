import { action, initialize } from "./api.mjs";
import { fillIcons } from "./icons.mjs";
import { KnowledgeTree } from "./tree.mjs";
import { Inspector } from "./inspector.mjs";
import { Workspace } from "./workspace.mjs";
import { Dialogs } from "./dialogs.mjs";
import { EventPanel } from "./panel.mjs";
import { node, replace } from "./dom.mjs";
import { initializeTheme } from "./theme.mjs";
import { LibraryShell } from "./shell.mjs";
import { LibraryManagement } from "./library-management.mjs";

fillIcons();
const theme = initializeTheme();
let shell;
let toastTimer;
function notify(message, error = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${error ? "error" : "success"}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), error ? 9000 : 3500);
}
function onError(error) {
  notify(`${error.message}${error.eventId ? ` · 事件 ${error.eventId}` : ""}`, true);
}

const inspector = new Inspector({
  onSaved: (cap) => workspace.saved(cap), onError,
  getDraft: (name, entry) => workspace.editor.drafts.get(workspace.editor.key(name, entry === name ? undefined : entry)),
  onEdit: async (record) => {
    await tree.chooseFromOverview(record);
    if (workspace.cap?.name === record.name) await workspace.openDetails(record);
  },
});
const panel = new EventPanel({
  onError,
  onAttention: (count) => shell?.setAttention(count),
  onReverted: async (event) => {
    notify(`${event.name} 已回撤并保存新版本`);
    await workspace.refresh(true);
    tree.refresh();
  },
  onDeleted: async (event) => {
    let recreated = false;
    try { await action("stat", { name: event.name }); recreated = true; }
    catch (error) { if (error.status !== 404) throw error; }
    if (!recreated) {
      workspace.removed(event.name);
      if (tree.selected?.name === event.name) tree.selected = null;
    } else if (workspace.cap?.name === event.name) await workspace.refresh(true);
    await tree.refresh();
    await workspace.home((item) => tree.chooseFromOverview(item));
    notify(`${event.name} 原 cap 已清除${recreated ? "；检测到同名新 cap，保留当前内容与草稿供核对" : ""}${event.error ? `；${event.error.message} · 事件 ${event.id}` : ""}`, Boolean(event.error || recreated));
  },
});
const dialogs = new Dialogs({
  onError,
  onCreated: async (cap, path) => {
    notify(`${cap.name} 已创建`);
    if (!path) await tree.setMode("all");
    else await tree.refresh();
    tree.choose({ ...cap, path });
  },
  onRevert: (event) => panel.watch(event),
  onRun: async (cap, args, logCap) => {
    panel.open("output");
    replace(panel.body, node("p", "loading", `正在同步并运行 ${cap.name}…`));
    try {
      const result = await action("run", { name: cap.name, args, logCap });
      panel.showRun(result);
      if (result.exitCode !== 0 || result.logError) notify("运行已返回，请查看执行结果和诊断", true);
      else notify(`${cap.name} 运行完成`);
    } catch (error) {
      if (error.result) panel.showRun(error.result);
      else replace(panel.body, node("p", "error-message file-empty", error.message));
      onError(error);
    }
  },
});
const create = () => dialogs.create(tree.selected?.path || "/");
const workspace = new Workspace({
  inspector,
  onError,
  onChanged: () => tree.refresh(),
  onCreate: create,
  onRun: (cap, dirty) => dialogs.run(cap, dirty),
  onRevert: (cap, target, dirty) => dialogs.revert(cap, target, dirty),
  onUpload: (cap, entry) => dialogs.upload(cap, entry, async (saved) => {
    notify(`${saved.name} 原件已保存`);
    workspace.saved(saved);
    await workspace.refresh(true);
  }),
});
const management = new LibraryManagement({
  dialogs,
  draftState: (name) => workspace.draftState(name),
  onPending: (event) => panel.watch(event),
  onUnlinked: async (item) => {
    workspace.unlinked(item);
    if (tree.selected?.path === item.path) tree.selected = { ...tree.selected, path: undefined };
    await tree.refresh();
    notify(`已断开 ${item.path}，cap 内容仍保留`);
  },
});
const tree = new KnowledgeTree(document.getElementById("tree"), {
  onSelect: async (item) => {
    if (await workspace.select(item) === false) { tree.selected = workspace.item; tree.render(); }
  },
  onError,
  onViewChanged: () => shell?.updateView(),
  onManage: (operation, item) => operation === "properties" ? inspector.open(item) : management.open(operation, item),
});

shell = new LibraryShell({ tree, panel, dialogs, theme, onCreate: create, onReconnect: connect, onError });
window.addEventListener("beforeunload", (event) => {
  const dirty = [...workspace.editor.drafts.values(), ...inspector.drafts.values(), ...workspace.databaseDrafts.values()].some((draft) => draft.dirty);
  if (dirty || workspace.office?.hasDirty()) { event.preventDefault(); event.returnValue = ""; }
});

async function connect() {
  shell.setConnection(false, "连接中");
  try {
    const session = await initialize();
    const health = await action("health");
    shell.setConnection(health.status === "ok", health.status === "ok" ? "已连接" : "连接异常", session.serverUrl);
    await tree.refresh();
    if (!tree.selected && tree.mode === "tree" && tree.items.length === 1 && tree.items[0].hasChildren) await tree.toggle(tree.items[0]);
    await workspace.home((item) => tree.chooseFromOverview(item));
    const initial = new URLSearchParams(location.search).get("cap");
    if (initial && !workspace.cap) {
      try { await tree.chooseFromOverview(await action("stat", { name: initial })); }
      catch (error) { onError(error); }
    }
    await workspace.refresh();
  } catch (error) {
    shell.setConnection(false, "连接失败 · 点击重试");
    onError(error);
  }
}
setInterval(() => { workspace.refresh(); inspector.refresh(); }, 5000);
await connect();
panel.startPolling();
