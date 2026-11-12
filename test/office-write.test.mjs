import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { ApiClient } from "../src/api/client.mjs";
import { patchExcel } from "../src/office/excel.mjs";
import { patchWord } from "../src/office/word.mjs";
import { writeOffice } from "../src/office/write.mjs";
import { parseOffice } from "../src/preview/office.mjs";

async function workbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("预算");
  sheet.getCell("A1").value = 21;
  sheet.getCell("A1").font = { bold: true, color: { argb: "FF216820" } };
  sheet.getCell("A1").numFmt = '"¥"0.00';
  sheet.getCell("B1").value = { formula: "A1*2", result: 42 };
  sheet.addConditionalFormatting({ ref: "A1:A10", rules: [{ type: "dataBar", gradient: false, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF216820" } }] });
  workbook.addWorksheet("说明").getCell("A1").value = "原始第二张表";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function templateBuffer() {
  return Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph({ text: "模板说明", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun("客户："), new TextRun({ text: "{{customer}}", bold: true })] }),
    new Paragraph("保留原正文"),
  ] }] }));
}

test("ExcelJS写回保留其他工作表和样式，并让公式等待重算", async () => {
  const output = await patchExcel(await workbookBuffer(), { cells: [{ sheet: "预算", cell: "A1", value: 30 }] });
  const workbook = await new ExcelJS.Workbook().xlsx.load(output);
  assert.equal(workbook.getWorksheet("预算").getCell("A1").value, 30);
  assert.equal(workbook.getWorksheet("预算").getCell("A1").font.bold, true);
  assert.equal(workbook.getWorksheet("预算").getCell("A1").numFmt, '"¥"0.00');
  assert.equal(workbook.getWorksheet("预算").getCell("B1").value.formula, "A1*2");
  assert.equal(workbook.getWorksheet("预算").getCell("B1").value.result, undefined);
  assert.equal(workbook.getWorksheet("说明").getCell("A1").value, "原始第二张表");
  assert.equal(workbook.getWorksheet("预算").conditionalFormattings[0].rules[0].type, "dataBar");
  const preview = await parseOffice(output, "excel");
  assert.deepEqual(preview.sheets[0].rows[0], ["30", "=A1*2"]);
  await assert.rejects(patchExcel(output, { cells: [{ sheet: "预算", cell: "A1", value: { formula: "RUN()" } }] }), { status: 400 });
});

test("docx模板填充保留原段落样式，缺失标记不会静默写回", async () => {
  const original = await templateBuffer();
  const output = await patchWord(original, { replacements: { customer: "Apex <script>" } });
  const converted = await mammoth.convertToHtml({ buffer: output });
  assert.match(converted.value, /<strong>Apex &lt;script&gt;<\/strong>/);
  const preview = await parseOffice(output, "word");
  assert.equal(preview.blocks[0].type, "heading");
  assert.equal(preview.blocks[1].text, "客户：Apex <script>");
  assert.equal(preview.blocks[2].text, "保留原正文");
  await assert.rejects(patchWord(original, { replacements: { missing: "test" } }), /缺少占位符/);
  assert.match((await mammoth.extractRawText({ buffer: original })).value, /{{customer}}/);
});

test("共享办公写入保留调用者token、原始冲突事件并清理暂存", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "capsule-office-write-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = await workbookBuffer();
  let uploads = 0;
  let conflict = false;
  const api = new ApiClient({ home, serverUrl: "http://backend.invalid" }, async (url, init) => {
    if (new URL(url).pathname.endsWith("/content")) {
      if (init.method !== "PUT") return new Response(source);
      uploads++;
      assert.equal(init.headers.get("If-Match"), "current-token");
      const chunks = [];
      for await (const chunk of init.body) chunks.push(chunk);
      assert.equal((await parseOffice(Buffer.concat(chunks), "excel")).sheets[0].rows[0][0], "40");
      if (conflict) return Response.json({ error: "版本冲突", eventId: "receipt-conflict" }, { status: 409 });
      return Response.json({ name: "预算.xlsx", token: "new-token", commit: "new-commit" });
    }
    return Response.json({ name: "预算.xlsx", token: "current-token", commit: "current-commit" });
  });
  const fields = { token: "current-token", changes: { cells: [{ sheet: "预算", cell: "A1", value: 40 }] } };
  assert.equal((await writeOffice(api, "预算.xlsx", fields)).token, "new-token");
  assert.deepEqual(await readdir(join(home, "uploads")), []);
  await assert.rejects(writeOffice(api, "预算.xlsx", { ...fields, token: "stale" }), { status: 409 });
  assert.equal(uploads, 1);
  conflict = true;
  await assert.rejects(writeOffice(api, "预算.xlsx", fields), { status: 409, eventId: "receipt-conflict" });
  assert.deepEqual(await readdir(join(home, "uploads")), []);
  assert.equal(uploads, 2);
});
