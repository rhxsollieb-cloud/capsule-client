import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { dispatch } from "../src/commands/dispatch.mjs";
import { boundedResult } from "../src/commands/output.mjs";

function fixture(respond) {
  const calls = [];
  const api = new ApiClient({ serverUrl: "http://search.invalid" }, async (url, init) => {
    const address = new URL(url);
    assert.equal(address.pathname, "/api/search");
    assert.equal(init.method, "GET");
    const query = Object.fromEntries(address.searchParams);
    assert.equal(query["scan-all"], undefined);
    calls.push(query);
    return Response.json(respond(Number(query.offset ?? 0)));
  });
  return { calls, run: (...args) => dispatch(parseArguments(["search", "/", ...args]), api) };
}

function page(from, to, total, items = [], extra = {}) {
  return { items, total, returned: items.length, scanned: { from, to, total }, nextOffset: to < total ? to : null,
    truncated: to < total || !!extra.incomplete?.length, ...extra };
}

test("自动续页按候选游标前进，保留空命中页的逐cap限制和匹配标记", async () => {
  const incomplete = { name: "过长的正文", reason: "文本扫描字节上限", next: { operation: "details", from: 1 } };
  const found = { name: "有命中", matches: [{ source: "content", line: 8, text: "文本" }], positionsTruncated: true };
  const { calls, run } = fixture((offset) => offset === 5
    ? page(5, 8, 10, [], { incomplete: [incomplete], incompleteTruncated: true })
    : page(8, 10, 10, [found]));
  const result = await run("--offset", "5", "--text", "文本", "--scan-all");
  assert.deepEqual(calls.map(({ offset }) => offset), ["5", "8"]);
  assert.deepEqual(result.items, [found]);
  assert.deepEqual(result.incomplete, [incomplete]);
  assert.equal(result.incompleteTruncated, true);
  assert.equal(result.truncated, true);
  assert.equal(result.nextOffset, null);
  assert.deepEqual(result.scanned, { from: 5, to: 10, total: 10 });
});

test("默认仍只查一页，损坏的候选游标不会被继续使用", async () => {
  const first = page(0, 2, 5, [{ name: "首个命中" }]);
  const { calls, run } = fixture((offset) => offset === 0 ? first : page(2, 2, 5));
  assert.deepEqual(await run("--text", "测试"), first);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].offset, undefined);
  await assert.rejects(run("--scan-all"), (error) => {
    assert.deepEqual(error.result.items, first.items);
    assert.equal(error.result.nextOffset, 2);
    return error.code === "INVALID_RESPONSE";
  });
  assert.deepEqual(calls.map(({ offset }) => offset), [undefined, "0", "2"]);
});

test("输出预算不足时从未纳入的候选页续查，--out使用独立聚合预算", async () => {
  const second = { name: "较大命中", matches: [{ text: "长".repeat(600) }] };
  const { calls, run } = fixture((offset) => offset === 0 ? page(0, 2, 3, [{ name: "首个命中" }]) : page(2, 3, 3, [second]));
  const clipped = await run("--scan-all", "--max-chars", "512");
  assert.equal(clipped.stopReason, "output-limit");
  assert.equal(clipped.nextOffset, 2);
  assert.equal(clipped.scanned.to, 2);
  assert.deepEqual(boundedResult(clipped, 512).items, [{ name: "首个命中" }]);
  assert.deepEqual(calls.map(({ offset }) => offset), ["0", "2"]);

  const unable = await run("--scan-all", "--offset", "2", "--max-chars", "512");
  assert.equal(unable.scanned.from, 2);
  assert.equal(unable.scanned.to, 2);
  assert.equal(unable.dataOmitted, true);
  assert.equal(unable.nextOffset, 2);

  const saved = await run("--scan-all", "--offset", "2", "--max-chars", "512", "--out", "回执.json");
  assert.deepEqual(saved.items, [second]);
  assert.equal(saved.nextOffset, null);
});

test("自动续页到达总页数上限时保留最后的候选游标", async () => {
  const { calls, run } = fixture((offset) => page(offset, offset + 1, 25));
  const result = await run("--scan-all", "--limit", "1");
  assert.equal(calls.length, 20);
  assert.equal(result.pages, 20);
  assert.equal(result.stopReason, "page-limit");
  assert.equal(result.nextOffset, 20);
  assert.deepEqual(result.scanned, { from: 0, to: 20, total: 25 });
});
