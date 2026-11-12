import { action, initialize } from "./api.mjs";
import { fillIcons } from "./icons.mjs";
import { KnowledgeTree } from "./tree.mjs";
import { Inspector } from "./inspector.mjs";
import { Workspace } from "./workspace.mjs";
import { Dialogs } from "./dialogs.mjs";
import { EventPanel } from "./panel.mjs";
import { node, replace } from "./dom.mjs";
import { initializeTheme } from "./theme.mjs";

fillIcons();
initializeTheme();
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

const inspector = new Inspector({ onSaved: (cap) => workspace.saved(cap), onError });
const panel = new EventPanel({
  onError,
  onReverted: async (event) => {
    notify(`${event.name} 已回撤并保存新版本`);
    await workspace.refresh(true);
    tree.refresh();
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
const tree = new KnowledgeTree(document.getElementById("tree"), {
  onSelect: async (item) => {
    if (await workspace.select(item) === false) { tree.selected = workspace.item; tree.render(); }
  },
  onError,
});

document.getElementById("new-cap").addEventListener("click", create);
document.getElementById("refresh-tree").addEventListener("click", () => tree.refresh());
document.getElementById("activity-library").addEventListener("click", () => {
  panel.close();
  document.getElementById("search").focus();
});
document.getElementById("activity-events").addEventListener("click", () => {
  if (panel.element.classList.contains("hidden")) panel.open();
  else panel.close();
});
document.getElementById("activity-agent").addEventListener("click", () => dialogs.agent());
document.getElementById("toggle-inspector").addEventListener("click", () => inspector.toggle());
const search = document.getElementById("search");
let searchTimer;
search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => tree.search(search.value.trim()), 250);
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    search.focus();
    search.select();
  }
});
window.addEventListener("beforeunload", (event) => {
  const dirty = [...workspace.editor.drafts.values(), ...inspector.drafts.values(), ...workspace.databaseDrafts.values()].some((draft) => draft.dirty);
  if (dirty || workspace.office?.hasDirty()) { event.preventDefault(); event.returnValue = ""; }
});

function connection(connected, message) {
  const element = document.getElementById("connection");
  element.classList.toggle("connected", connected);
  element.classList.toggle("disconnected", !connected);
  document.getElementById("connection-label").textContent = message;
}
async function connect() {
  connection(false, "连接中");
  try {
    const session = await initialize();
    document.getElementById("status-server").textContent = session.serverUrl;
    const health = await action("health");
    connection(health.status === "ok", health.status === "ok" ? "已连接" : "连接异常");
    await tree.refresh();
    if (!tree.selected && tree.mode === "tree" && tree.items.length === 1 && tree.items[0].hasChildren) await tree.toggle(tree.items[0]);
    await workspace.home((item) => tree.chooseFromOverview(item));
    await workspace.refresh();
  } catch (error) {
    connection(false, "连接失败 · 点击重试");
    onError(error);
  }
}
document.getElementById("connection").addEventListener("click", connect);
panel.startPolling();
setInterval(() => workspace.refresh(), 5000);
await connect();
