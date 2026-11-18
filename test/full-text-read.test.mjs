import assert from "node:assert/strict";
import test from "node:test";
import { readText } from "../web/api.mjs";

const record = (body, from, to, total, token = "original") => ({ token, body,
  lines: { from, to, total, nextLine: to < total ? to + 1 : null, truncated: from > 1 || to < total } });

test("全文载入按连续完整行拼接，首段也核对原token", async (t) => {
  const pages = [record("第一行\n", 1, 2, 3), record("末行", 3, 3, 3)];
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(init.body)); return Response.json(pages.shift());
  });
  const result = await readText("全书.md", undefined, () => true, { token: "original" });
  assert.equal(result.body, "第一行\n\n末行");
  assert.deepEqual(result.lines, { from: 1, to: 3, total: 3, nextLine: null, truncated: false });
  assert.deepEqual(requests.map((value) => value.from), [1, 3]);
  pages.push(record("新版本", 1, 1, 1, "changed"));
  await assert.rejects(readText("全书.md", undefined, () => true, { token: "original" }), { code: "VERSION_CONFLICT" });
});

test("退回游标、缺行、伪装全文和跨页行数变化均拒绝，不进入编辑", async (t) => {
  let pages;
  t.mock.method(globalThis, "fetch", async () => Response.json(pages.shift()));
  for (const second of [
    record("重叠行", 1, 1, 2), record("漏行", 3, 3, 3),
    record("末行", 2, 2, 3), { ...record("末行", 2, 2, 2), body: "多行\n伪造" },
  ]) {
    pages = [record("首行", 1, 1, 2), second];
    await assert.rejects(readText("全书.md", undefined, () => true), { code: "INVALID_RESPONSE" });
  }
});

test("取消全文读取会中止在途请求，不再请求后续页面", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls++;
    assert.equal(init.signal, controller.signal);
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  });
  const pending = readText("全书.md", undefined, () => true, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 1);
});
