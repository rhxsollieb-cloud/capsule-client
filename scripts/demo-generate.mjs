import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const dependencies = process.env.CAPSULE_DEMO_DEPENDENCIES || join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies");
const require = createRequire(join(dependencies, "node/node_modules/package.json"));
const { Workbook, SpreadsheetFile } = await import(require.resolve("@oai/artifact-tool"));
const output = resolve(root, ".local/demo-fixtures");
const artifacts = resolve(root, ".local/demo-build/outputs/capsule-ui-demo");
await mkdir(output, { recursive: true });
await mkdir(artifacts, { recursive: true });

function execute(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0)
    throw new Error(`${command} 失败：${result.error?.message || result.stderr}`);
}

const picture = process.env.CAPSULE_DEMO_IMAGE || resolve(root, "../videoseed/应用/前端/public/demo/lake.jpg");
await copyFile(picture, join(output, "视觉参考.jpg"));
execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=6:sample_rate=44100", "-af", "afade=t=in:d=0.15,afade=t=out:st=5:d=1,volume=0.25", join(output, "提示音.wav")]);
execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", picture, "-i", join(output, "提示音.wav"), "-vf", "scale=960:540:force_original_aspect_ratio=increase,crop=960:540,zoompan=z='min(zoom+0.0005,1.12)':d=180:s=960x540:fps=30", "-t", "6", "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", join(output, "演示片段.mp4")]);

const workbook = Workbook.create();
const budget = workbook.worksheets.add("报价预算");
const shots = workbook.worksheets.add("分镜计划");
for (const sheet of [budget, shots]) {
  sheet.showGridLines = false;
  sheet.getRange("A1:G22").format.font = { name: "Arial", size: 11, color: "#111111" };
  sheet.getRange("A1:G22").format.verticalAlignment = "center";
  sheet.getRange("A1:G22").format.rowHeight = 25;
  sheet.getRange("A1:A22").format.columnWidth = 22;
  sheet.getRange("B1:B22").format.columnWidth = 16;
  sheet.getRange("C1:F22").format.columnWidth = 14;
  sheet.getRange("G1:G22").format.columnWidth = 45;
  sheet.getRange("A2").format.font = { size: 16, bold: true };
}
budget.getRange("A2").values = [["山野短片报价预算"]];
budget.getRange("A3").values = [["开发样例  金额单位为人民币元"]];
budget.getRange("A5:E5").values = [["项目", "数量", "单位", "单价", "小计"]];
budget.getRange("A6:D11").values = [
  ["前期策划", 1, "项", 800], ["拍摄执行", 2, "人天", 1200],
  ["设备使用", 1, "天", 600], ["剪辑", 2, "人天", 1000],
  ["声音整理", 1, "项", 350], ["交付整理", 1, "项", 200],
];
budget.getRange("E6").formulas = [["=B6*D6"]];
budget.getRange("E6:E11").fillDown();
budget.getRange("A13").values = [["合计"]];
budget.getRange("E13").formulas = [["=SUM(E6:E11)"]];
budget.getRange("G6").values = [["输入来源：本地原创开发样例，非真实报价。"]];
budget.getRange("G8").values = [["蓝色数字为输入，黑色数字为计算结果。"]];
budget.getRange("B6:B11").format.font = { color: "#1547AB" };
budget.getRange("D6:D11").format.font = { color: "#1547AB" };
budget.getRange("D6:E13").setNumberFormat('#,##0;(#,##0);"–"');
budget.getRange("A13:E13").format.font = { bold: true };
budget.getRange("A13:E13").format.borders = { top: { color: "#777777", style: "thin" } };
shots.getRange("A2").values = [["山野短片分镜计划"]];
shots.getRange("A3").values = [["开发样例  片长 30 秒"]];
shots.getRange("A5:F9").values = [
  ["镜头", "场景", "景别", "时长 秒", "状态", "素材编号"],
  ["S01", "山脊", "远景", 8, "已准备", "M001"],
  ["S02", "步道", "中景", 10, "待拍摄", "M002"],
  ["S03", "叶片", "特写", 6, "待拍摄", "M003"],
  ["S04", "湖面", "远景", 6, "已准备", "M004"],
];
shots.getRange("A11").values = [["总时长 秒"]];
shots.getRange("D11").formulas = [["=SUM(D6:D9)"]];
shots.getRange("G6").values = [["输入来源：本地原创开发样例。"]];
for (const sheet of [budget, shots]) {
  const header = sheet === budget ? "A5:E5" : "A5:F5";
  sheet.getRange(header).format = { fill: "#303841", font: { color: "#FFFFFF", bold: true }, horizontalAlignment: "center" };
}
workbook.recalculate();
const total = budget.getRange("E13").values[0][0];
const duration = shots.getRange("D11").values[0][0];
if (total !== 6350 || duration !== 30) throw new Error(`示例计算不符：${total} / ${duration}`);
budget.getRange("B6").values = [[2]];
workbook.recalculate();
if (budget.getRange("E13").values[0][0] !== 7150) throw new Error("输入变化没有更新报价结果");
budget.getRange("B6").values = [[1]];
workbook.recalculate();
for (const sheet of [budget, shots]) {
  const preview = await workbook.render({ sheetName: sheet.name, range: "A1:G15", scale: 1.5, format: "png" });
  await writeFile(join(artifacts, `${sheet.name}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 20 }, maxChars: 1500 });
await writeFile(join(artifacts, "formula-scan.ndjson"), errors.ndjson);
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
const xlsxFile = join(artifacts, "报价预算.xlsx");
await xlsx.save(xlsxFile);
await copyFile(xlsxFile, join(output, "报价预算.xlsx"));

const python = process.env.CAPSULE_DEMO_PYTHON || join(dependencies, "python/bin/python3");
execute(python, [join(dirname(fileURLToPath(import.meta.url)), "demo-document.py"), join(output, "拍摄说明.docx")]);
process.stdout.write(`示例文件已生成：${output}\n`);
