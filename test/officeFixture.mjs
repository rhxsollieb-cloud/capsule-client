import { deflateRawSync } from "node:zlib";

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function zipBuffer(parts, { deflate = false } = {}) {
  const records = [];
  const directory = [];
  let offset = 0;
  for (const [path, text] of Object.entries(parts)) {
    const filename = Buffer.from(path);
    const data = Buffer.from(text);
    const encoded = deflate ? deflateRawSync(data) : data;
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(encoded.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(encoded.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    records.push(local, filename, encoded);
    directory.push(central, filename);
    offset += local.length + filename.length + encoded.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(directory.reduce((sum, part) => sum + part.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, ...directory, end]);
}

export function wordBuffer() {
  return zipBuffer({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>拍摄说明</w:t></w:r></w:p><w:p><w:r><w:t>保留 &lt;script&gt; 为纯文本 &amp; 不执行</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>场次</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>一</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  });
}

export function excelBuffer() {
  return zipBuffer({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="预算" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/sharedStrings.xml": '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>摄影</t></si></sst>',
    "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>项目</t></is></c><c r="B1" t="inlineStr"><is><t>金额</t></is></c></row><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>1200</v></c><c r="C2"><f>B2*2</f><v>2400</v></c><c r="D2"><f>1+1</f></c></row></sheetData></worksheet>',
  });
}
