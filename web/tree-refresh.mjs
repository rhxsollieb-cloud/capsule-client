import { action } from "./api.mjs";

function visibleBranches(tree) {
  const paths = [], visited = new Set();
  let loading = false;
  const visit = (items) => {
    for (const item of items) {
      const page = tree.expanded.get(item.path);
      if (!page || visited.has(item.path)) continue;
      visited.add(item.path);
      if (page.loading) { loading = true; continue; }
      paths.push(item.path);
      visit(page.items || []);
    }
  };
  visit(tree.items);
  return { paths, loading };
}

const busy = (tree) => tree.loadingRequest !== undefined || tree.moreLoading === tree.request || Boolean(tree.pendingChildren?.size);
const projection = (page) => JSON.stringify({ nextOffset: page.nextOffset ?? null, total: page.total,
  items: page.items.map(({ name, path, kind, description, hasChildren, permissions }) => ({ name, path, kind, description, hasChildren, permissions })) });
function removedPaths(previous, next) {
  if (next.nextOffset !== null && next.nextOffset !== undefined) return [];
  const present = new Set(next.items.map((item) => item.path));
  return previous.items.filter((item) => item.path && !present.has(item.path)).map((item) => item.path);
}

function redraw(tree) {
  const scroll = tree.element.scrollTop;
  const active = globalThis.document?.activeElement;
  const focus = active && tree.element.contains?.(active) ? {
    path: active.closest?.(".tree-row")?.dataset.path,
    className: active.className, label: active.getAttribute?.("aria-label"),
  } : null;
  tree.render();
  if (focus?.path) [...tree.element.querySelectorAll(".tree-row button")].find((control) =>
    control.closest(".tree-row").dataset.path === focus.path && control.className === focus.className
    && control.getAttribute("aria-label") === focus.label)?.focus({ preventScroll: true });
  tree.element.scrollTop = scroll;
}

export async function refreshTreeBackground(tree) {
  if (tree.backgroundRefreshing || busy(tree)) return false;
  const branches = tree.isTreeView() ? visibleBranches(tree) : { paths: [], loading: false };
  if (branches.loading) return false;
  const snapshot = { request: tree.request, items: tree.items, count: tree.items.length, nextOffset: tree.nextOffset,
    expanded: new Map(tree.expanded) };
  const current = () => tree.request === snapshot.request && tree.items === snapshot.items && tree.items.length === snapshot.count
    && tree.nextOffset === snapshot.nextOffset && !busy(tree) && tree.expanded.size === snapshot.expanded.size
    && [...snapshot.expanded].every(([path, value]) => tree.expanded.get(path) === value);
  tree.backgroundRefreshing = true;
  let applied = false;
  try {
    const results = await Promise.allSettled([
      tree.fetchRange((offset) => tree.fetchPage(offset), snapshot.count, snapshot.request),
      ...branches.paths.map((path) => tree.fetchRange((offset) => action("ls", { path, limit: 50, offset }),
        snapshot.expanded.get(path)?.items?.length || 0, snapshot.request)),
    ]);
    if (!current()) return false;
    if (results[0].status === "rejected") throw results[0].reason;
    const root = results[0].value;
    let changed = projection({ items: tree.items, nextOffset: tree.nextOffset, total: tree.total }) !== projection(root);
    const errors = [];
    const removed = tree.isTreeView() ? removedPaths({ items: tree.items }, root) : [];
    branches.paths.forEach((path, index) => {
      if (results[index + 1].status === "fulfilled") removed.push(...removedPaths(snapshot.expanded.get(path), results[index + 1].value));
    });
    const absent = (path) => removed.some((parent) => path === parent || path.startsWith(parent + "/"));
    applied = true;
    tree.items = root.items; tree.nextOffset = root.nextOffset; tree.total = root.total;
    for (const path of tree.expanded.keys()) if (absent(path)) { tree.expanded.delete(path); changed = true; }
    for (let index = 0; index < branches.paths.length; index++) {
      const result = results[index + 1], path = branches.paths[index];
      if (absent(path)) continue;
      if (result.status === "rejected") { errors.push(result.reason); continue; }
      if (projection(tree.expanded.get(path)) !== projection(result.value)) changed = true;
      tree.expanded.set(path, result.value);
    }
    if (changed) { redraw(tree); tree.onEmpty?.(root.total === 0); }
    if (errors.length) throw errors[0];
    tree.backgroundError = null;
    return changed;
  } catch (error) {
    if (!applied && !current()) return false;
    const label = `${error.status || ""}:${error.message}`;
    if (tree.backgroundError !== label) tree.onError?.(error);
    tree.backgroundError = label;
    return false;
  } finally { tree.backgroundRefreshing = false; }
}
