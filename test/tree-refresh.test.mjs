import assert from "node:assert/strict";
import test from "node:test";
import { KnowledgeTree } from "../web/tree.mjs";

const page = (items, { total = items.length, nextOffset = null } = {}) => ({ items, total, nextOffset });
const branch = { name: "目录.md", path: "/目录.md", kind: "markdown", hasChildren: true };
const child = { name: "正文.md", path: "/目录.md/正文.md", kind: "markdown", hasChildren: false };
function fixture(t, respond) {
  const calls = [], errors = [], selections = [];
  const element = { scrollTop: 80, addEventListener() {} };
  const tree = new KnowledgeTree(element, { onSelect: (item) => selections.push(item), onError: (error) => errors.push(error) });
  let renders = 0, loadingRenders = 0;
  tree.render = () => { renders++; element.scrollTop = 0; };
  tree.renderLoading = () => { loadingRenders++; };
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const input = JSON.parse(init.body); calls.push(input);
    const result = await respond(input);
    return result instanceof Response ? result : Response.json(result);
  });
  tree.items = [branch]; tree.total = 1; tree.nextOffset = null;
  return { tree, calls, errors, selections, element, renders: () => renders, loadingRenders: () => loadingRenders };
}

test("未变的已展开目录不重绘或触发选择，只查询当前可见层", { timeout: 5000 }, async (t) => {
  const state = fixture(t, ({ path }) => path === "/" ? page([branch]) : page([child]));
  state.tree.expanded.set(branch.path, page([child]));
  state.tree.expanded.set("/不可见旧目录", page([]));
  state.tree.selected = child;
  assert.equal(await state.tree.refreshBackground(), false);
  assert.equal(state.renders(), 0);
  assert.equal(state.loadingRenders(), 0);
  assert.equal(state.tree.selected, child);
  assert.equal(state.element.scrollTop, 80);
  assert.deepEqual(state.selections, []);
  assert.deepEqual(state.calls.map(({ path }) => path), ["/", branch.path]);
});

test("外部挂载更新已展开层，保留根和子层更多页、选择与滚动", { timeout: 5000 }, async (t) => {
  const roots = [branch, ...Array.from({ length: 99 }, (_, index) => ({ name: `根${index}`, path: `/根${index}` }))];
  const children = Array.from({ length: 100 }, (_, index) => ({ name: `子${index}`, path: `/目录.md/子${index}` }));
  const incoming = [{ name: "新Skill", path: "/目录.md/新Skill", kind: "code" }, ...children];
  const state = fixture(t, ({ path, offset = 0 }) => {
    const items = path === "/" ? roots : incoming;
    return page(items.slice(offset, offset + 50), { total: items.length, nextOffset: offset + 50 < items.length ? offset + 50 : null });
  });
  state.tree.items = roots; state.tree.total = 100;
  state.tree.expanded.set(branch.path, page(children));
  state.tree.selected = children[80];
  assert.equal(await state.tree.refreshBackground(), true);
  assert.equal(state.tree.items.length, 100);
  assert.equal(state.tree.expanded.get(branch.path).items.length, 100);
  assert.equal(state.tree.expanded.get(branch.path).nextOffset, 100);
  assert.equal(state.tree.selected, children[80]);
  assert.equal(state.element.scrollTop, 80);
  assert.equal(state.renders(), 1);
  assert.deepEqual(state.selections, []);
  assert.deepEqual(state.calls.map(({ path, offset }) => [path, offset]), [["/", 0], [branch.path, 0], ["/", 50], [branch.path, 50]]);
});

test("子层暂时读取失败保留展开缓存，重复相同错误只提示一次", { timeout: 5000 }, async (t) => {
  const state = fixture(t, ({ path }) => path === "/" ? page([branch]) : Response.json({ error: "暂时不可用" }, { status: 503 }));
  const previous = page([child]);
  state.tree.expanded.set(branch.path, previous);
  await state.tree.refreshBackground();
  await state.tree.refreshBackground();
  assert.equal(state.tree.expanded.get(branch.path), previous);
  assert.equal(state.renders(), 0);
  assert.equal(state.errors.length, 1);
});

test("后台迟到结果不覆盖过滤或刚展开的子树", { timeout: 5000 }, async (t) => {
  let finish;
  const state = fixture(t, ({ path }) => path === "/" ? new Promise((resolve) => { finish = resolve; }) : page([child]));
  const old = state.tree.refreshBackground();
  await state.tree.toggle(branch);
  finish(page([{ ...branch, description: "过期根" }]));
  await old;
  assert.equal(state.tree.items[0].description, undefined);
  assert.deepEqual(state.tree.expanded.get(branch.path).items, [child]);
  const stale = state.tree.refreshBackground();
  state.tree.request++; state.tree.query = "新过滤";
  finish(page([{ name: "旧根" }]));
  await stale;
  assert.equal(state.tree.query, "新过滤");
  assert.equal(state.tree.items[0].name, branch.name);
});

test("折叠重开共享未完成读，旧toggle不能清掉当前展开状态", { timeout: 5000 }, async (t) => {
  let finish, reads = 0;
  const state = fixture(t, () => ++reads === 1 ? new Promise((resolve) => { finish = resolve; }) : page([child]));
  const old = state.tree.toggle(branch);
  await state.tree.toggle(branch);
  const reopened = state.tree.toggle(branch);
  finish(page([{ name: "过期子层" }]));
  await Promise.all([old, reopened]);
  // api.mjs deliberately coalesces identical concurrent reads. The current
  // toggle owns that response; the older toggle must not mutate its state.
  assert.equal(reads, 1);
  assert.deepEqual(state.tree.expanded.get(branch.path).items, [{ name: "过期子层" }]);
  assert.equal(state.renders(), 4);
  assert.deepEqual(state.errors, []);
});

test("完整父列表确认已卸载时清掉隐藏展开缓存，保留当前内容选择", { timeout: 5000 }, async (t) => {
  const state = fixture(t, ({ path }) => path === "/" ? page([]) : Response.json({ error: "位置不存在" }, { status: 404 }));
  state.tree.expanded.set(branch.path, page([child]));
  state.tree.expanded.set(child.path, page([]));
  state.tree.selected = child;
  await state.tree.refreshBackground();
  assert.equal(state.tree.expanded.size, 0);
  assert.equal(state.tree.selected, child);
  assert.deepEqual(state.errors, []);
});

test("实际过滤完成后迟到后台结果不能覆盖过滤页或重新选择正文", { timeout: 5000 }, async (t) => {
  let finish;
  const filtered = { name: "过滤结果.md", kind: "markdown", permissions: { read: true, edit: true } };
  const state = fixture(t, (input) => input.action === "list" ? page([filtered])
    : new Promise((resolve) => { finish = resolve; }));
  state.tree.selected = child;
  const previous = state.tree.refreshBackground();
  await state.tree.setFilter("  过滤结果  ");
  assert.equal(state.tree.query, "过滤结果");
  assert.deepEqual(state.tree.items, [filtered]);
  const renders = state.renders();
  finish(page([{ ...branch, description: "迟到旧页" }]));
  assert.equal(await previous, false);
  assert.deepEqual(state.tree.items, [filtered]);
  assert.equal(state.renders(), renders);
  assert.equal(state.tree.selected, child);
  assert.deepEqual(state.selections, []);
  assert.deepEqual(state.errors, []);
  assert.equal(state.calls.filter((input) => input.action === "list").length, 1);
});

test("根加载更多先完成时，迟到后台第一页不能收回已加载页面", { timeout: 5000 }, async (t) => {
  const roots = Array.from({ length: 100 }, (_, index) => ({ name: `根${index}`, path: `/根${index}` }));
  let finish;
  const state = fixture(t, ({ offset = 0 }) => offset === 0 ? new Promise((resolve) => { finish = resolve; }) : page(roots.slice(50)));
  state.tree.items = roots.slice(0, 50); state.tree.nextOffset = 50; state.tree.total = 100;
  state.tree.selected = roots[15];
  const pending = state.tree.refreshBackground();
  await state.tree.more();
  finish(page(roots.slice(0, 50), { total: 100, nextOffset: 50 }));
  assert.equal(await pending, false);
  assert.deepEqual(state.tree.items, roots);
  assert.equal(state.tree.nextOffset, null);
  assert.equal(state.tree.selected, roots[15]);
  assert.deepEqual(state.selections, []);
  assert.equal(state.renders(), 1);
});

test("子层加载更多先完成时，后台旧子页不能覆盖新页数量", { timeout: 5000 }, async (t) => {
  const children = Array.from({ length: 100 }, (_, index) => ({ name: `子${index}`, path: `/目录.md/子${index}` }));
  let finish;
  const state = fixture(t, ({ path, offset = 0 }) => path === "/" ? page([branch])
    : offset === 0 ? new Promise((resolve) => { finish = resolve; }) : page(children.slice(50)));
  state.tree.expanded.set(branch.path, page(children.slice(0, 50), { total: 100, nextOffset: 50 }));
  const pending = state.tree.refreshBackground();
  await state.tree.moreChildren(branch);
  finish(page(children.slice(0, 50), { total: 100, nextOffset: 50 }));
  assert.equal(await pending, false);
  assert.deepEqual(state.tree.expanded.get(branch.path).items, children);
  assert.equal(state.tree.expanded.get(branch.path).nextOffset, null);
  assert.equal(state.renders(), 1);
  assert.deepEqual(state.selections, []);
});

test("前台读取期间不发后台请求，相同后台刷新不会叠加", { timeout: 5000 }, async (t) => {
  let finish;
  const state = fixture(t, () => new Promise((resolve) => { finish = resolve; }));
  for (const prepare of [
    () => { state.tree.loadingRequest = state.tree.request; },
    () => { state.tree.moreLoading = state.tree.request; },
    () => { state.tree.pendingChildren = new Set([branch.path]); },
    () => { state.tree.expanded.set(branch.path, { loading: true }); },
  ]) {
    prepare();
    assert.equal(await state.tree.refreshBackground(), false);
    state.tree.loadingRequest = undefined; state.tree.moreLoading = undefined; state.tree.pendingChildren = new Set(); state.tree.expanded.clear();
  }
  assert.equal(state.calls.length, 0);
  const first = state.tree.refreshBackground();
  assert.equal(await state.tree.refreshBackground(), false);
  assert.equal(state.calls.length, 1);
  finish(page([branch]));
  await first;
  assert.equal(state.tree.backgroundRefreshing, false);
  assert.equal(state.loadingRenders(), 0);
});

test("根读取失败保留全部缓存且后续恢复仍能显示新挂载", { timeout: 5000 }, async (t) => {
  let unavailable = true;
  const incoming = { name: "新增.md", path: "/新增.md", kind: "markdown" };
  const state = fixture(t, ({ path }) => path === "/" ? unavailable
    ? Response.json({ error: "根暂不可用" }, { status: 503 }) : page([branch, incoming]) : page([child]));
  const previous = page([child]); state.tree.expanded.set(branch.path, previous); state.tree.selected = child;
  const items = state.tree.items;
  await state.tree.refreshBackground();
  assert.equal(state.tree.items, items);
  assert.equal(state.tree.expanded.get(branch.path), previous);
  assert.equal(state.renders(), 0);
  assert.equal(state.errors.length, 1);
  unavailable = false;
  assert.equal(await state.tree.refreshBackground(), true);
  assert.deepEqual(state.tree.items, [branch, incoming]);
  assert.equal(state.tree.backgroundError, null);
  assert.equal(state.tree.selected, child);
  assert.deepEqual(state.selections, []);
});

test("父列表仍有未加载页时不能误删暂未出现的展开缓存", { timeout: 5000 }, async (t) => {
  const state = fixture(t, ({ path }) => path === "/" ? page([{ name: "新增根", path: "/新增根" }], { total: 51, nextOffset: 50 }) : page([child]));
  const previous = page([child]); state.tree.expanded.set(branch.path, previous);
  await state.tree.refreshBackground();
  assert.equal(state.tree.expanded.has(branch.path), true);
  assert.deepEqual(state.tree.expanded.get(branch.path).items, [child]);
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.selections, []);
});
