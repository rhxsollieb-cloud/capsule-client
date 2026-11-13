import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiClient } from "../src/api/client.mjs";
import { configuration } from "../src/config.mjs";
import { demoDescription } from "./demo-content.mjs";

const api = new ApiClient(configuration());
const name = "报价协作 Skill";
const root = fileURLToPath(new URL("../examples/quote-skill/", import.meta.url));
const description = "Skill 人机协作开发示例；由 quote-skill 模板创建。";

async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await files(join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error("Skill 示例只允许普通目录和文件");
  }
  return result;
}
try {
  let existing;
  try { existing = await api.json(api.path(name)); } catch (error) { if (error.status !== 404) throw error; }
  if (existing) {
    process.stdout.write(JSON.stringify({ name, skipped: true, reason: "已有同名 cap，未覆盖内容或挂载" }) + "\n");
  } else {
    let cap = await api.json("/api/capsules", "POST", { name, kind: "code", description });
    const entries = await files(root);
    entries.sort((left, right) => Number(left === "scripts/ui.mjs") - Number(right === "scripts/ui.mjs") || left.localeCompare(right));
    for (const entry of entries) cap = await api.upload(name, entry, join(root, entry), cap.token);
    let parent = "/";
    try {
      const demo = await api.json(api.path("示例工作区.md"));
      if (demo.description === demoDescription) parent = `/${demo.name}/`;
    } catch (error) { if (error.status !== 404) throw error; }
    const path = `${parent}${name}`;
    await api.json("/api/mounts", "POST", { name, path });
    process.stdout.write(JSON.stringify({ name, kind: cap.kind, commit: cap.commit, path, created: true }) + "\n");
  }
} catch (error) {
  process.stderr.write(`${api.redact(error.message)}${error.eventId ? ` · 事件 ${error.eventId}` : ""}。已完成的 cap 写入保留，重跑不会覆盖同名 cap。\n`);
  process.exitCode = 1;
}
