import assert from "node:assert/strict";
import test from "node:test";
import { EventPanel } from "../web/panel.mjs";

test("事件确认区分清除与回撤，重复终态只通知一次", async () => {
  const completed = [];
  const panel = Object.assign(Object.create(EventPanel.prototype), {
    watched: new Map([["delete-id", {}], ["revert-id", {}]]),
    finishing: new Set(),
    onDeleted: (event) => completed.push(["delete", event.name]),
    onReverted: (event) => completed.push(["revert", event.name]),
    onError(error) { throw error; },
  });
  const deleted = { id: "delete-id", type: "delete", status: "succeeded", name: "旧.txt", result: { name: "旧.txt", removed: true } };
  await panel.finish({ ...deleted, status: "running" });
  assert.equal(panel.watched.size, 2);
  await panel.finish(deleted);
  await panel.finish(deleted);
  await panel.finish({ id: "revert-id", type: "revert", status: "succeeded", name: "保留.txt" });
  assert.deepEqual(completed, [["delete", "旧.txt"], ["revert", "保留.txt"]]);
});

test("清除失败及不完整结果不会清除客户端内容", async () => {
  const errors = [];
  const panel = Object.assign(Object.create(EventPanel.prototype), {
    watched: new Map([["conflict", {}], ["incomplete", {}]]),
    finishing: new Set(),
    onDeleted() { assert.fail("失败不能清除客户端"); },
    onError: (error) => errors.push(error.message),
  });
  await panel.finish({ id: "conflict", type: "delete", status: "conflict", error: { message: "版本已更新" } });
  await panel.finish({ id: "incomplete", type: "delete", status: "succeeded", name: "旧.txt" });
  assert.match(errors[0], /版本已更新/);
  assert.match(errors[1], /结果不完整/);
});

test("终态同步失败保留原事件供重查，同时到达的终态不会重复同步", async () => {
  let attempts = 0;
  let release;
  const panel = Object.assign(Object.create(EventPanel.prototype), {
    watched: new Map([["id", {}]]), finishing: new Set(),
    onDeleted() {
      attempts++;
      if (attempts === 1) throw new Error("暂时无法核对同名实体");
      return new Promise((resolve) => { release = resolve; });
    },
  });
  const event = { id: "id", type: "delete", name: "旧.txt", status: "succeeded", result: { name: "旧.txt", removed: true } };
  await assert.rejects(panel.finish(event), /暂时无法/);
  assert.equal(panel.watched.size, 1);
  const retry = panel.finish(event);
  await panel.finish(event);
  assert.equal(attempts, 2);
  release();
  await retry;
  assert.equal(panel.watched.size, 0);
});
