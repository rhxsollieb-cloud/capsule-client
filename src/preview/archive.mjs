import { promisify } from "node:util";
import yauzl from "yauzl";
import { limits, previewError } from "./limits.mjs";
import { validateXml } from "./xml.mjs";

const openArchive = promisify(yauzl.fromBuffer);

async function inspectPart(archive, entry, xml) {
  const stream = await new Promise((resolve, reject) => {
    archive.openReadStream(entry, (error, source) => error ? reject(error) : resolve(source));
  });
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > (xml ? limits.xmlBytes : limits.fileBytes))
      throw previewError("办公文件内部条目超过展开上限", 413);
    if (xml) chunks.push(chunk);
  }
  if (xml) validateXml(Buffer.concat(chunks).toString("utf8"));
}

export async function inspectOfficeArchive(buffer) {
  if (buffer.length > limits.fileBytes) throw previewError("办公原件超过 16 MiB 上限", 413);
  let archive;
  try {
    archive = await openArchive(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
    if (archive.entryCount > limits.archiveEntries)
      throw previewError("办公文件包含过多 ZIP 条目", 413);
    await new Promise((resolve, reject) => {
      const names = new Set();
      let total = 0;
      let xmlTotal = 0;
      const fail = (error) => { archive.close(); reject(error); };
      archive.on("error", fail);
      archive.on("end", resolve);
      archive.on("entry", (entry) => {
        const consume = async () => {
          if (names.has(entry.fileName)) throw previewError("办公文件包含重复 ZIP 条目");
          names.add(entry.fileName);
          if (/vbaProject\.bin$/i.test(entry.fileName))
            throw previewError("含宏的办公文件不支持处理", 415);
          const xml = /\.(?:xml|rels)$/i.test(entry.fileName);
          total += entry.uncompressedSize;
          if (xml) xmlTotal += entry.uncompressedSize;
          if (total > limits.archiveBytes || xmlTotal > limits.totalXmlBytes ||
              entry.uncompressedSize > (xml ? limits.xmlBytes : limits.fileBytes))
            throw previewError("办公文件展开内容超过上限", 413);
          if (!entry.fileName.endsWith("/")) await inspectPart(archive, entry, xml);
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
