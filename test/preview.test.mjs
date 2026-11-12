import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../src/api/client.mjs";
import { dispatch } from "../src/cli.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { limits } from "../src/preview/limits.mjs";
import { parseOffice, previewOffice } from "../src/preview/office.mjs";
import { performAction } from "../src/ui/actions.mjs";
import { excelBuffer, wordBuffer, zipBuffer } from "./officeFixture.mjs";

test("Word 正文、标题与表格只提取纯文本", async () => {
  const result = await parseOffice(wordBuffer(), "word");
  assert.deepEqual(result, {
    kind: "word",
    blocks: [
      { type: "heading", level: 1, text: "拍摄说明" },
      { type: "paragraph", text: "保留 <script> 为纯文本 & 不执行" },
      { type: "table", rows: [["场次", "一"]] },
    ],
    truncated: false,
  });
});

test("Excel 共享文本、内联文本、缓存值与公式回退不执行计算", async () => {
  const result = await parseOffice(excelBuffer(), "excel");
  assert.deepEqual(result, {
    kind: "excel",
    sheets: [{ name: "预算", rows: [["项目", "金额"], ["摄影", "1200", "2400", "=1+1"]], truncated: false }],
    truncated: false,
  });
});

test("Office 拒绝损坏ZIP、DTD、宏和外部工作表", async () => {
  await assert.rejects(parseOffice(Buffer.from("not zip"), "word"), { status: 422 });
  await assert.rejects(parseOffice(zipBuffer({
    "word/document.xml": '<!DOCTYPE doc [<!ENTITY expand "hello">]><doc>&expand;</doc>',
  }), "word"), /DTD/);
  await assert.rejects(parseOffice(zipBuffer({
    "word/document.xml": "<doc/>", "word/vbaProject.bin": "macro",
  }), "word"), { status: 415 });
  await assert.rejects(parseOffice(zipBuffer({
    "xl/workbook.xml": '<workbook xmlns:r="urn:rel"><sheets><sheet name="外部" r:id="r1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" TargetMode="External" Target="https://example.invalid/sheet.xml"/></Relationships>',
  }), "excel"), /外部/);
});

test("压缩XML膨胀、XML深度与行列边界明确限制", async () => {
  const compressed = zipBuffer({ "word/document.xml": " ".repeat(limits.xmlBytes + 1) }, { deflate: true });
  assert.ok(compressed.length < 16 * 1024);
  await assert.rejects(parseOffice(compressed, "word"), { status: 413 });
  const nested = "<a>".repeat(limits.xmlDepth + 1) + "</a>".repeat(limits.xmlDepth + 1);
  await assert.rejects(parseOffice(zipBuffer({ "word/document.xml": nested }), "word"), { status: 413 });
  const result = await parseOffice(zipBuffer({
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet sheetId="1" name="边界" r:id="r1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="AE1"><v>31</v></c></row><row r="201"><c r="A201"><v>201</v></c></row></sheetData></worksheet>',
  }), "excel");
  assert.equal(result.sheets[0].rows.length, limits.rows);
  assert.equal(result.sheets[0].rows[0][0], "1");
  assert.ok(result.sheets[0].rows.every((row) => row.length <= limits.columns));
  assert.equal(result.truncated, true);
  assert.equal(result.sheets[0].truncated, true);
});

function apiFixture({ commits = ["current", "current"], response = () => new Response(wordBuffer()) } = {}) {
  const paths = [];
  let read = 0;
  const api = new ApiClient({ serverUrl: "http://backend.invalid" }, async (url) => {
    const path = new URL(url);
    paths.push(path);
    if (path.pathname.endsWith("/content")) return response();
    return Response.json({ name: "说明.docx", commit: commits[read++ % commits.length] });
  });
  return { api, paths };
}

test("CLI 和本地UI预览复用共享读取与提交保护", async () => {
  const { api, paths } = apiFixture();
  const ui = await performAction(api, { action: "preview", name: "资料包", entry: "说明.docx" });
  const cli = await dispatch(parseArguments(["preview", "资料包", "说明.docx"]), api);
  assert.deepEqual(cli, ui);
  assert.equal(ui.commit, "current");
  assert.equal(ui.entry, "说明.docx");
  assert.equal(paths.filter((path) => path.pathname.endsWith("/content"))[0].searchParams.get("entry"), "说明.docx");
  const changed = apiFixture({ commits: ["before", "after"] });
  await assert.rejects(previewOffice(changed.api, "说明.docx"), { status: 409 });
});

test("预览拒绝旧格式并在流式读取超限时取消传输", async () => {
  const fixture = apiFixture();
  await assert.rejects(previewOffice(fixture.api, "旧文档.doc"), { status: 415 });
  assert.equal(fixture.paths.length, 0);
  let cancelled = false;
  const declared = apiFixture({ response: () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), { headers: { "Content-Length": String(limits.fileBytes + 1) } }) });
  await assert.rejects(previewOffice(declared.api, "大文件.docx"), { status: 413 });
  assert.equal(cancelled, true);
  cancelled = false;
  const chunked = apiFixture({ response: () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  })) });
  await assert.rejects(previewOffice(chunked.api, "流式.docx"), { status: 413 });
  assert.equal(cancelled, true);
});
