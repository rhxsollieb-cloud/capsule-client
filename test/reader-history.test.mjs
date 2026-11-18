import assert from "node:assert/strict";
import test from "node:test";
import { PagedTextReader } from "../web/reader.mjs";

test("返回段落读取失败时保留当前内容与返回记录，重试成功后再消耗历史", async () => {
  const original = { lines: { from: 201, to: 400, nextLine: 401 } };
  const previous = { lines: { from: 1, to: 200, nextLine: 201 } };
  let fail = true;
  const errors = [];
  const reader = Object.assign(Object.create(PagedTextReader.prototype), {
    history: [{ from: 1, to: 200 }], record: original, note: {}, isCurrent: () => true,
    controls() {}, onError: (error) => errors.push(error),
    page: async (from) => { assert.equal(from, 1); if (fail) throw new Error("临时读取失败"); return previous; },
    display(record, { push }) { assert.equal(push, false); this.record = record; },
  });
  await reader.back();
  assert.equal(reader.record, original);
  assert.deepEqual(reader.history, [{ from: 1, to: 200 }]);
  assert.equal(errors.length, 1);
  assert.equal(reader.busy, false);
  fail = false;
  await reader.back();
  assert.equal(reader.record, previous);
  assert.deepEqual(reader.history, []);
  assert.equal(errors.length, 1);
});
