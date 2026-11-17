import { Document, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";
import mammoth from "mammoth";

// Synthetic protocol artifacts only: this does not model Office layout or fidelity.
export async function readProtocolDocument(type, buffer) {
  if (type === "docx") return (await mammoth.extractRawText({ buffer })).value.replace(/\n\n/g, "\n").trimEnd();
  if (type === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const rows = [];
    workbook.worksheets[0]?.eachRow((row) => rows.push(row.values.slice(1).map((value) => String(value ?? "")).join("\t")));
    return rows.join("\n");
  }
  throw new Error(`Office protocol substitute does not support ${type}`);
}

export async function writeProtocolDocument(type, body) {
  if (type === "docx") return Packer.toBuffer(new Document({ sections: [{ children: body.split("\n").map((line) => new Paragraph(line)) }] }));
  if (type === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("协议替身数据");
    for (const line of body.split("\n")) sheet.addRow(line.split("\t"));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  throw new Error(`Office protocol substitute does not support ${type}`);
}
