import { promisify } from "node:util";
import yauzl from "yauzl";
import { limits, previewError } from "./limits.mjs";

const openArchive = promisify(yauzl.fromBuffer);

function selected(name, kind) {
  if (kind === "word") return name === "word/document.xml";
  return ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml"].includes(name)
    || /^xl\/worksheets\/[^/]+\.xml$/.test(name);
}

async function readPart(archive, entry) {
  const stream = await new Promise((resolve, reject) => {
    archive.openReadStream(entry, (error, source) => error ? reject(error) : resolve(source));
  });
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limits.xmlBytes) throw previewError("办公文件 XML 超过 8 MiB 预览上限", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function officeParts(buffer, kind) {
  if (buffer.length > limits.fileBytes) throw previewError("办公原件超过 16 MiB 预览上限", 413);
  let archive;
  try {
    archive = await openArchive(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
    if (archive.entryCount > limits.archiveEntries)
      throw previewError("办公文件包含过多 ZIP 条目", 413);
    return await new Promise((resolve, reject) => {
      const parts = new Map();
      let total = 0;
      const fail = (error) => {
        archive.close();
        reject(error);
      };
      archive.on("error", fail);
      archive.on("end", () => resolve(parts));
      archive.on("entry", (entry) => {
        const consume = async () => {
          if (/vbaProject\.bin$/i.test(entry.fileName))
            throw previewError("含宏的办公文件不支持预览", 415);
          if (!selected(entry.fileName, kind)) return;
          if (parts.has(entry.fileName)) throw previewError("办公文件包含重复 XML 条目");
          if (entry.uncompressedSize > limits.xmlBytes)
            throw previewError("办公文件 XML 超过 8 MiB 预览上限", 413);
          total += entry.uncompressedSize;
          if (total > limits.totalXmlBytes)
            throw previewError("办公文件 XML 总量超过 24 MiB 预览上限", 413);
          parts.set(entry.fileName, await readPart(archive, entry));
        };
        consume().then(() => archive.readEntry(), fail);
      });
      archive.readEntry();
    });
  } catch (error) {
    if (error.status) throw error;
    throw previewError("办公文件 ZIP 无效或内容损坏");
  } finally {
    archive?.close();
  }
}
