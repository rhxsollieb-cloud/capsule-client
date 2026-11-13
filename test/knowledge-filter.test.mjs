import test from "node:test";
import assert from "node:assert/strict";
import { KnowledgeTree } from "../web/tree.mjs";

function fixture(t, respond) {
  const calls = [], errors = [], selected = [];
  const element = { scrollTop: 70, addEventListener() {} };
  const tree = new KnowledgeTree(element, { onSelect: (item) => selected.push(item), onError: (error) => errors.push(error) });
  tree.renderLoading = () => tree.renderModes();
  tree.render = () => tree.renderModes();
  t.mock.method(globalThis, "fetch", (_url, options) => {
    const input = JSON.parse(options.body);
    calls.push(input);
    return Promise.resolve(respond(input)).then((result) => result instanceof Response ? result : Response.json(result));
  });
  t.after(() => clearTimeout(tree.filterTimer));
  return { tree, calls, errors, selected, element };
}

const page = (items = [], nextOffset = null) => ({ items, nextOffset, total: items.length });

test("过滤和类别联合服务端分页，切类别不清空查询", async (t) => {
  const { tree, calls } = fixture(t, (input) => page([{ name: `cap-${input.offset}` }], input.offset === 0 ? 50 : null));
  await tree.setFilter("项目");
  await tree.setKind("markdown");
  await tree.more();
  assert.deepEqual(calls.map(({ action, query, kind, offset }) => ({ action, query, kind, offset })), [
    { action: "list", query: "项目", kind: undefined, offset: 0 },
    { action: "list", query: "项目", kind: "markdown", offset: 0 },
    { action: "list", query: "项目", kind: "markdown", offset: 50 },
  ]);
  assert.equal(tree.items.length, 2);
  assert.equal(tree.nextOffset, null);
});

test("清空还原树展开与位置，不切换内容；新选过则保留新选择", async (t) => {
  const original = { name: "原内容", path: "/资料/原内容" };
  const { tree, calls, selected, element } = fixture(t, () => page());
  tree.selected = original;
  tree.expanded.set("/资料", page([original]));
  await tree.setFilter("新");
  assert.equal(calls.some((input) => input.action === "ls"), false);
  element.scrollTop = 0;
  await tree.setFilter("");
  assert.equal(tree.selected, original);
  assert.equal(tree.expanded.has("/资料"), true);
  assert.equal(element.scrollTop, 70);
  assert.deepEqual(selected, []);
  assert.deepEqual(calls.slice(-2).map((input) => [input.action, input.path]), [["ls", "/"], ["ls", "/资料"]]);

  await tree.setFilter("新");
  const next = { name: "新内容" };
  tree.choose(next);
  await tree.setFilter("");
  assert.equal(tree.selected, next);
  assert.deepEqual(selected, [next]);
});

test("输入防抖立即隔离旧响应，旧失败不覆盖当前过滤", async (t) => {
  let finish;
  const { tree, errors } = fixture(t, (input) => input.query === "旧" ? new Promise((resolve) => { finish = resolve; }) : page([{ name: input.query }]));
  const old = tree.setFilter("旧");
  await tree.setFilter("新", { delay: 1000 });
  finish(Response.json({ error: "旧请求失败" }, { status: 503 }));
  await old;
  assert.deepEqual(errors, []);
  assert.equal(tree.query, "新");
  assert.equal(tree.items.some((item) => item.name === "旧"), false);
  await tree.refresh();
  assert.deepEqual(tree.items, [{ name: "新" }]);
});

test("分页中变更过滤不会混入旧页，重复触发仅请求一次", async (t) => {
  let finish;
  const { tree, calls } = fixture(t, (input) => input.offset === 50 ? new Promise((resolve) => { finish = resolve; }) : page([{ name: input.query }], 50));
  await tree.setFilter("旧");
  const old = tree.more();
  await tree.more();
  assert.equal(calls.filter((input) => input.offset === 50).length, 1);
  await tree.setFilter("新");
  finish(page([{ name: "旧的下一页" }]));
  await old;
  assert.deepEqual(tree.items, [{ name: "新" }]);
});

test("清空后按原已加载范围续读分页，保留第二页选择和展开内容", async (t) => {
  const makeItems = (prefix, offset, path = "") => Array.from({ length: 50 }, (_, index) => ({ name: `${prefix}-${offset + index}`, path: `${path}/${prefix}-${offset + index}` }));
  const root = [...makeItems("root", 0), ...makeItems("root", 50)];
  const children = [...makeItems("child", 0, "/branch"), ...makeItems("child", 50, "/branch")];
  const { tree, calls } = fixture(t, (input) => {
    if (input.action === "list") return page([]);
    return page(makeItems(input.path === "/" ? "root" : "child", input.offset, input.path === "/" ? "" : "/branch"), input.offset === 0 ? 50 : null);
  });
  tree.items = root;
  tree.nextOffset = null;
  tree.expanded.set("/branch", page(children));
  tree.selected = children[80];
  await tree.setFilter("别的");
  await tree.setFilter("");
  assert.equal(tree.items.length, 100);
  assert.equal(tree.expanded.get("/branch").items.length, 100);
  assert.equal(tree.selected.name, children[80].name);
  assert.deepEqual(calls.filter((call) => call.action === "ls").map(({ path, offset }) => [path, offset]), [["/", 0], ["/", 50], ["/branch", 0], ["/branch", 50]]);
});
