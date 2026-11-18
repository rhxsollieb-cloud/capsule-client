import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { readTextInput, TEXT_INPUT_LIMIT } from "../commands/input.mjs";
import { virtualPath } from "../operations/mounts.mjs";
import { capsuleName } from "../system/paths.mjs";
import { inspectImportDirectory } from "./archive.mjs";

const directoryKinds = ["markdown", "files", "code"];
const fileKinds = ["markdown", "text", "image", "audio", "video", "excel", "word", "file", "database"];
const fields = new Set(["file", "directory", "name", "kind", "description", "path"]);
const invalid = (message) => Object.assign(new Error(message), { code: "BAD_REQUEST", status: 400 });

async function verifySqlite(file) {
  const descriptor = await open(file, "r");
  try {
    const header = Buffer.alloc(16);
    await descriptor.read(header);
    if (header.toString() !== "SQLite format 3\0") throw invalid(`需要有效的SQLite原件：${file}`);
  } finally { await descriptor.close(); }
}

async function inspectSourceBytes(file, size, { body, verify, text }) {
  if (!verify && !text) return undefined;
  const hashes = verify ? ["sha1", "sha256"].map((algorithm) => createHash(algorithm).update(`blob ${size}\0`)) : [];
  const decoder = text ? new TextDecoder("utf-8", { fatal: true }) : undefined;
  const decode = (chunk) => {
    if (chunk?.includes(0)) throw invalid(`文字输入包含NUL：${file}`);
    try { decoder.decode(chunk, { stream: chunk !== undefined }); }
    catch { throw invalid(`文字来源必须为有效UTF-8：${file}`); }
  };
  const source = body === undefined ? createReadStream(file) : [Buffer.from(body)];
  let bytes = 0;
  for await (const chunk of source) {
    if (decoder) decode(chunk);
    for (const hash of hashes) hash.update(chunk);
    bytes += chunk.length;
  }
  if (decoder) decode();
  if (bytes !== size) throw invalid(`读取时文件长度变化：${file}`);
  return verify ? hashes.map((hash) => hash.digest("hex")) : undefined;
}

async function fileSource(input, file, verify) {
  const info = await lstat(file);
  if (!info.isFile()) throw invalid(`导入需要实际的普通文件：${file}`);
  const { kind } = input;
  const text = ["markdown", "text"].includes(kind);
  if (kind === "database") await verifySqlite(file);
  if (text && info.size <= TEXT_INPUT_LIMIT) {
    const body = await readTextInput(file);
    if (Buffer.byteLength(JSON.stringify({ ...input, body })) <= TEXT_INPUT_LIMIT) input.body = body;
  }
  const entry = kind === "markdown" ? "README.md" : kind === "database" ? "data.sqlite" : undefined;
  const bytes = input.body === undefined ? info.size : Buffer.byteLength(input.body);
  const blobIds = await inspectSourceBytes(file, bytes, { body: input.body, verify: verify && kind !== "database", text: text && info.size > TEXT_INPUT_LIMIT });
  return { file, bytes, entry, blobIds };
}

export async function planImport(manifest, directory, { verify } = {}) {
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 100) throw invalid("导入清单需要1至100项");
  const names = new Set();
  const plan = [];
  for (const [index, item] of manifest.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !fields.has(key)))
      throw invalid(`清单第${index + 1}项的字段无效`);
    const sourceType = item.directory === undefined ? "file" : "directory";
    if (typeof item[sourceType] !== "string" || !item[sourceType] || (sourceType === "directory" && item.file !== undefined))
      throw invalid(`清单第${index + 1}项需要一个file或directory`);
    const source = resolve(directory, item[sourceType]);
    const name = capsuleName(item.name);
    const key = name.toLocaleLowerCase("en-US");
    if (names.has(key)) throw invalid(`清单内名称重复：${name}`);
    names.add(key);
    const { kind = "markdown", description = "" } = item;
    if (!(sourceType === "directory" ? directoryKinds : fileKinds).includes(kind)) throw invalid(`清单第${index + 1}项的来源与类别不匹配`);
    if (typeof description !== "string" || description.length > 180) throw invalid(`简述最多180字符：${name}`);
    const path = item.path === undefined ? undefined : virtualPath(item.path, { root: false });
    if (path && posix.basename(path) !== name) throw invalid(`挂载末段必须等于胶囊名称：${path}`);
    const input = { name, kind, description };
    if (sourceType === "directory") {
      await inspectImportDirectory(source, kind);
      plan.push({ input, path, directory: source });
    } else {
      plan.push({ input, path, ...await fileSource(input, source, verify) });
    }
  }
  return plan;
}
