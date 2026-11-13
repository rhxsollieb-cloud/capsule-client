import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ApiClient } from "../src/api/client.mjs";
import { configuration, assertNodeVersion } from "../src/config.mjs";
import { runCapsule } from "../src/runtime/run.mjs";
import { briefBody, calculatorBody, databaseStatements, demoDescription, rootBody } from "./demo-content.mjs";

assertNodeVersion();
const api = new ApiClient(configuration());
const fixture = (name) => fileURLToPath(new URL(`../.local/demo-fixtures/${name}`, import.meta.url));
const created = [];
const skipped = [];
const rootName = "示例工作区.md";

async function create(name, kind, body, initialize, runtime) {
  try {
    await api.json(api.path(name));
    skipped.push(name);
    return;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  let cap = await api.json("/api/capsules", "POST", { name, kind, description: demoDescription, ...(body === undefined ? {} : { body }), ...(runtime ? { runtime } : {}) });
  if (initialize) cap = await initialize(cap);
  const path = name === rootName ? `/${rootName}` : `/${rootName}/${name}`;
  await api.json("/api/mounts", "POST", { name, path });
  created.push({ name, kind, commit: cap.commit });
}

async function write(cap, entry, body) {
  return api.json(api.path(cap.name, "write"), "POST", { entry, body, token: cap.token });
}

async function seed() {
  for (const file of ["视觉参考.jpg", "提示音.wav", "演示片段.mp4", "报价预算.xlsx", "拍摄说明.docx"]) await access(fixture(file));
  await api.json("/api/health");
  await create(rootName, "markdown", rootBody);
  // Never attach new children beneath a user-owned cap that happens to have this name.
  const root = await api.json(api.path(rootName));
  if (root.description !== demoDescription) throw new Error("同名根节点不是演示数据，未更改它或新增挂载。");
  await api.json("/api/mounts", "POST", { name: rootName, path: `/${rootName}` });
  await create("产品简报.md", "markdown", briefBody);
  for (const [name, kind] of [["视觉参考.jpg", "image"], ["提示音.wav", "audio"], ["演示片段.mp4", "video"], ["报价预算.xlsx", "excel"], ["拍摄说明.docx", "word"]])
    await create(name, kind, undefined, (cap) => api.upload(name, undefined, fixture(name), cap.token));
  await create("资料包", "files", "# 资料包\n\n开发样例。说明、表格和清单在这个 cap 的原生文件中独立保存。\n", async (cap) => {
    cap = await write(cap, "README.md", "# 资料包\n\n这里演示 files cap 的原生文件。\n\n- 说明.md：创建时的说明\n- 镜头清单.csv：可读文本表格\n- notes/收音要求.txt：目录中的补充说明\n\n这些文件由统一接口管理，整个 cap 拥有独立 Git 历史。\n");
    cap = await write(cap, "镜头清单.csv", "编号,画面,时长秒,状态\nS01,山脊远景,8,已准备\nS02,步道中景,10,待拍摄\nS03,叶片特写,6,待拍摄\nS04,湖面收尾,6,已准备\n");
    return write(cap, "notes/收音要求.txt", "开发样例\n每个场景单独录制至少 10 秒环境声。\n检查电平、风噪和背景人声，保留原始录音。\n");
  });
  await create("素材记录", "database", "# 素材记录\n\n开发样例。media_assets 保存素材状态，production_notes 保存文字日志，cap_run_logs 保存实际工具运行。媒体由本 cap 独立拥有。\n", async (cap) => {
    cap = await api.upload(cap.name, "media/湖面参考.jpg", fixture("视觉参考.jpg"), cap.token);
    return api.json(api.path(cap.name, "write"), "POST", { token: cap.token, statements: databaseStatements });
  });
  await create("报价计算器", "code", "# 报价计算器\n\n开发样例，按数量乘单价计算金额。默认数量 2、单价 1200 元。无需第三方依赖。\n", async (cap) => {
    return write(cap, "scripts/cli.mjs", calculatorBody);
  });
  let run;
  if (created.some((cap) => cap.name === "报价计算器")) {
    const logDatabase = await api.json(api.path("素材记录"));
    const runOptions = logDatabase.description === demoDescription && logDatabase.kind === "database"
      ? { logCap: "素材记录" }
      : {};
    if (!runOptions.logCap) process.stderr.write("同名素材记录不是开发样例，未写入远程运行日志。\n");
    const result = await runCapsule(api, "报价计算器", ["4", "1200"], runOptions);
    if (result.exitCode !== 0) throw new Error("报价计算器演示运行失败");
    run = { id: result.id, commit: result.commit, exitCode: result.exitCode, stdout: result.stdout };
  }
  return { created, skipped, ...(run ? { run } : {}), path: `/${rootName}` };
}

try {
  process.stdout.write(JSON.stringify(await seed(), null, 2) + "\n");
} catch (error) {
  process.stderr.write(`示例数据创建失败：${error.message}${error.eventId ? `（事件 ${error.eventId}）` : ""}\n`);
  process.stderr.write("已完成的写入保留。重跑会跳过已有同名 cap，不覆盖内容；请先核对失败位置。\n");
  process.exitCode = 1;
}
