import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";
import { ApiClient } from "../src/api/client.mjs";
import { configuration } from "../src/config.mjs";

const api = new ApiClient(configuration());
const directory = fileURLToPath(new URL("../.local/demo-fixtures/", import.meta.url));
const description = "目录正文与成熟库读写开发样例，由 demo-v2-seed 创建。";
const created = [];
const skipped = [];

async function create(name, kind, body, initialize) {
  try {
    await api.json(api.path(name));
    skipped.push(name);
    return;
  } catch (error) { if (error.status !== 404) throw error; }
  let cap = await api.json("/api/capsules", "POST", { name, kind, body, description });
  cap = await initialize(cap);
  await api.json("/api/mounts", "POST", { name, path: `/示例工作区.md/${name}` });
  created.push({ name, kind, commit: cap.commit });
}

const body = `# 山野手册

本页演示目录型 Markdown cap。第二列展开正文与附件；图片、音频和视频均由本 cap 独立保存。

## 图片参考

![湖面参考](assets/湖面.jpg)

## 音频记录

![合成提示音，6 秒](assets/提示音.wav)

## 视频记录

![湖面演示片段，6 秒](assets/演示片段.mp4)

## 内容结构

| 路径 | 用途 |
| --- | --- |
| README.md | 当前正文 |
| assets/ | 当前 cap 自有附件 |

保存正文、上传附件与整体回撤使用同一 cap 的版本保护。
这些计划、媒体和说明仅供开发演示。图片复制自本机 VideoSeed demo/lake.jpg，音视频为离线合成。
`;

try {
  for (const name of ["视觉参考.jpg", "提示音.wav", "演示片段.mp4"]) await access(directory + name);
  await mkdir(directory, { recursive: true });
  const template = new Document({
    sections: [{ children: [
      new Paragraph({ text: "短片制作委托书 · 开发模板", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun({ text: "项目：", bold: true }), new TextRun("{{project}}《原生样式保留》")] }),
      new Paragraph("委托方：{{customer}}"),
      new Paragraph("约定金额：{{quote}}"),
      new Paragraph("通过右上方‘填写Word模板’填入字段，保存会产生新的cap提交。"),
      new Paragraph("这是开发样例，不具有合同效力。原件保持DOCX格式，填写使用docx库的模板补丁。"),
    ] }],
  });
  const templateFile = directory + "委托模板.docx";
  await writeFile(templateFile, await Packer.toBuffer(template));
  await create("山野手册.md", "markdown", body, async (cap) => {
    for (const [entry, source] of [["湖面.jpg", "视觉参考.jpg"], ["提示音.wav", "提示音.wav"], ["演示片段.mp4", "演示片段.mp4"]])
      cap = await api.upload(cap.name, "assets/" + entry, directory + source, cap.token);
    return cap;
  });
  await create("委托模板.docx", "word", undefined,
    (cap) => api.upload(cap.name, undefined, templateFile, cap.token));
  const workbook = new ExcelJS.Workbook();
  const budget = workbook.addWorksheet("预算", { views: [{ state: "frozen", ySplit: 1 }] });
  budget.addRow(["项目", "数量", "单价（元）", "金额（元）"]);
  const items = [["前期策划", 1, 800], ["拍摄执行", 2, 1200], ["设备使用", 1, 600], ["剪辑", 2, 1000], ["声音整理", 1, 350], ["交付整理", 1, 200]];
  items.forEach((item, index) => {
    const number = index + 2;
    budget.addRow([...item, { formula: `B${number}*C${number}`, result: item[1] * item[2] }]);
  });
  const total = items.reduce((sum, item) => sum + item[1] * item[2], 0);
  budget.getCell("A9").value = "开发样例合计";
  budget.getCell("D9").value = { formula: "SUM(D2:D7)", result: total };
  budget.columns.forEach((column, index) => { column.width = index === 0 ? 26 : 18; });
  budget.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  budget.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF303841" } };
  budget.getColumn(3).numFmt = '#,##0.00';
  budget.getColumn(4).numFmt = '#,##0.00';
  const notes = workbook.addWorksheet("使用说明");
  notes.addRow(["这是通过ExcelJS生成的可写回开发示例，非真实报价。"]);
  notes.addRow(["修改指定单元格后，Excel打开原件会重新计算公式。"]);
  notes.getColumn(1).width = 78;
  if (total !== 6350) throw new Error("预算样例合计不符");
  const budgetFile = directory + "预算编辑示例.xlsx";
  await workbook.xlsx.writeFile(budgetFile);
  await create("预算编辑示例.xlsx", "excel", undefined,
    (cap) => api.upload(cap.name, undefined, budgetFile, cap.token));
  process.stdout.write(JSON.stringify({ created, skipped, path: "/示例工作区.md" }, null, 2) + "\n");
} catch (error) {
  process.stderr.write(`扩展示例创建失败：${error.message}\n`);
  process.stderr.write("已完成的写入保留；同名cap不会被覆盖，重跑前请先核对失败位置。\n");
  process.exitCode = 1;
}
