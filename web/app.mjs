import { action, connectionStatus, initialize, isSessionFailure, readIdentity, rebindSessionUrls } from "./api.mjs";
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
import { Administration } from "./admin.mjs";
import { canCreate, currentIdentity, setIdentity } from "./permissions.mjs";
import { startPolling } from "./polling.mjs";
import { Connection } from "./connection.mjs";
import { identityChangeProof } from "./identity-transition.mjs";
import { restoreConnectionContent, singleConnection } from "./connection-recovery.mjs";

fillIcons();
const theme = initializeTheme();
let shell;
let toastTimer;
let authenticated = false;
let lastPrincipal;
let lastServerUrl;
let lastOfficeUrl;
const connect = singleConnection(connectNow);
function notify(message, error = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${error ? "error" : "success"}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), error ? 9000 : 3500);
}
function onError(error) {
  notify(`${error.message}${error.eventId ? ` · 事件 ${error.eventId}` : ""}`, true);
  if (isSessionFailure(error)) void connect();
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
const create = () => { if (canCreate()) dialogs.create(tree.selected?.path || "/"); else onError(new Error("当前身份没有创建权限")); };
const workspace = new Workspace({
  inspector,
  onError,
  onChanged: () => tree.refresh(),
  onCreate: create,
  onCopy: (cap) => dialogs.copy(cap),
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
  onManage: (operation, item) => operation === "properties" ? inspector.open(item)
    : operation === "copy" ? dialogs.copy(item) : management.open(operation, item),
});

function applyIdentity(identity) {
  const changed = JSON.stringify(currentIdentity()) !== JSON.stringify(identity);
  if (identity?.principal) lastPrincipal = identity.principal;
  setIdentity(identity);
  shell?.setIdentity(identity);
  workspace.permissionsChanged();
  inspector.permissionsChanged();
  if (changed) tree.render();
}
const administration = new Administration({ onError, onIdentity: applyIdentity, getCap: () => workspace.cap });
function hasDrafts() {
  return [...workspace.editor.drafts.values(), ...inspector.drafts.values(), ...workspace.databaseDrafts.values()].some((draft) => draft.dirty || draft.saving)
    || workspace.office?.hasDirty() || workspace.office?.state.saving || administration.busy;
}
const connection = new Connection({
  canChange: (operation, values) => {
    Object.assign(values, identityChangeProof(operation, values, { dirty: hasDrafts(), principal: lastPrincipal, serverUrl: lastServerUrl, officeEditorUrl: lastOfficeUrl }));
    return true;
  },
  onChanged: async (operation, status, result) => {
    const principal = status.principal || result.principal;
    if (operation === "login" && (!lastPrincipal || principal?.id === lastPrincipal.id)) await connect();
    else location.reload();
  },
});
shell = new LibraryShell({ tree, panel, dialogs, theme, onCreate: create, onReconnect: connect,
  onConnection: () => connection.open({ identity: lastPrincipal }), onAdmin: () => administration.open(), onError });
window.addEventListener("beforeunload", (event) => {
  if (hasDrafts()) { event.preventDefault(); event.returnValue = ""; }
});

async function connectNow() {
  authenticated = false;
  try {
    shell.setConnection(false, "连接中");
    applyIdentity(null);
    const session = await initialize();
    const status = await connectionStatus();
    if (!status.authenticated) {
      authenticated = false;
      shell.setConnection(false, status.error || "请连接并登录");
      await connection.open({ required: true, identity: lastPrincipal });
      return;
    }
    const identity = await readIdentity();
    const switched = lastPrincipal && (identity.principal.id !== lastPrincipal.id || session.serverUrl !== lastServerUrl || session.officeEditorUrl !== lastOfficeUrl);
    if (switched) {
      if (hasDrafts()) {
        authenticated = false;
        await connection.open({ required: true, identity: lastPrincipal });
        throw new Error("CLI 或其他入口已切换账户，原草稿仍保留。请用原账户重新登录处理草稿，再切换身份。");
      }
      location.reload();
      return;
    }
    lastServerUrl = session.serverUrl;
    lastOfficeUrl = session.officeEditorUrl;
    applyIdentity(identity);
    authenticated = true;
    const health = await action("health");
    shell.setConnection(health.status === "ok", health.status === "ok" ? "已连接" : "连接异常", session.serverUrl);
    await tree.refresh();
    if (!tree.selected && tree.mode === "tree" && tree.items.length === 1 && tree.items[0].hasChildren) await tree.toggle(tree.items[0]);
    const hasSelection = await restoreConnectionContent({ workspace, tree, sessionChanged: session.sessionChanged,
      rebind: () => rebindSessionUrls(),
      onOfficeSessionChanged: (office) => notify(office.hasDirty()
        ? "登录已更新，Office草稿与编辑器已保留。请先核对保存或下载恢复原件，再重新打开文档。"
        : "登录已更新，Office编辑器已保留；若内容未显示，可在文件菜单重新打开当前版本。"),
    });
    if (!hasSelection) await workspace.home((item) => tree.chooseFromOverview(item));
    const initial = new URLSearchParams(location.search).get("cap");
    if (initial && !workspace.cap && !hasSelection) {
      try { await tree.chooseFromOverview(await action("stat", { name: initial })); }
      catch (error) { onError(error); }
    }
    panel.startPolling({ enabled: () => authenticated });
  } catch (error) {
    shell.setConnection(false, "连接失败 · 点击重试");
    if (error.status === 401) { authenticated = false; await connection.open({ required: true, identity: lastPrincipal }); }
    onError(error);
  }
}
startPolling(() => Promise.all([workspace.refresh(), inspector.refresh()]), { interval: 5000, enabled: () => authenticated });
startPolling(() => tree.refreshBackground(), { interval: 30000, enabled: () => authenticated });
startPolling(async () => {
  try {
    const status = await connectionStatus();
    if (!status.authenticated || status.principal.id !== lastPrincipal?.id || status.serverUrl !== lastServerUrl) { await connect(); return; }
    applyIdentity(await readIdentity());
  }
  catch (error) {
    applyIdentity(null); shell.setConnection(false, "身份状态未知 · 点击重新连接");
    if (isSessionFailure(error)) await connect();
  }
}, { interval: 30000, enabled: () => authenticated });
await connect();
