import assert from "node:assert/strict";
import test from "node:test";
import { exceedsMarkdownBudget, exceedsMarkdownBytes } from "../web/markdown-budget.mjs";

test("单行巨大HTML表格和大量内联节点在建DOM前拒绝，代码里的尖括号不误计", () => {
  assert.equal(exceedsMarkdownBudget([{ type: "html_block", content: "<table>" + "<tr><td>文字</td></tr>".repeat(10000) + "</table>" }]), true);
  assert.equal(exceedsMarkdownBudget([{ type: "inline", children: Array.from({ length: 30001 }, () => ({ type: "text" })) }]), true);
  assert.equal(exceedsMarkdownBudget([{ type: "fence", content: "<tag>".repeat(100000) }]), false);
  assert.equal(exceedsMarkdownBudget([{ type: "html_block", content: "<table>" + "<tr><td>文字</td></tr>".repeat(300) + "</table>" }]), false);
});

test("渲染前限制实际UTF-8字节，超大属性正文和多字节短字符串不会先全量解析", () => {
  assert.equal(exceedsMarkdownBytes("x".repeat(2 * 1024 * 1024)), false);
  assert.equal(exceedsMarkdownBytes("x".repeat(2 * 1024 * 1024 + 1)), true);
  assert.equal(exceedsMarkdownBytes("中".repeat(700000)), true);
});
