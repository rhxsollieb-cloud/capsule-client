export const demoDescription = "胶囊工作台开发样例，可自由编辑；由 demo-seed 创建。";
const fence = String.fromCharCode(96).repeat(3);

export const rootBody = `# 示例工作区

这组内容用于体验胶囊工作台。所有计划、金额和记录都是开发样例。

## 从这里开始

在左侧展开本节点，然后选择不同内容：

| 内容 | 可以体验的能力 |
| --- | --- |
| 产品简报.md | Markdown 阅读、正文编辑与版本保护 |
| 视觉参考.jpg | 图片画布与原件下载 |
| 提示音.wav | 音频播放与媒体属性 |
| 演示片段.mp4 | 视频播放与原件浏览 |
| 报价预算.xlsx | 工作表与单元格预览 |
| 拍摄说明.docx | 文档正文与表格阅读 |
| 资料包 | 一个 cap 中的原生文件 |
| 素材记录 | SQLite 表、媒体关联和运行日志 |
| 报价计算器 | 原生代码、提交同步和本地运行 |

## 数据边界

每个 cap 独立保存原件。数据库中的图片由上传接口复制到它自己的媒体区。
虚拟树用于组织主题，同名 cap 仍然只有一个身份。

图片复制自本机 VideoSeed 的应用/前端/public/demo/lake.jpg；原作者信息未在此样例中核实。
音频由正弦波离线合成，视频由该图片和合成音频离线制作。
Word、Excel、代码和其余正文是本地创作的开发样例。
`;

export const briefBody = `# 山野短片产品简报

用一支 **30 秒短片** 表现从山脊走向湖边的过程。此处是开发样例，便于观察不同知识内容如何组织在同一个工作区里。

## 核心方向

保留空间感与自然节奏。远景交代环境，中景连接行进路线，细节镜头补充触感。

> 先把画面和声音记录清楚，再决定剪辑节奏。

## 内容安排

| 段落 | 画面 | 时长 | 声音 |
| --- | --- | --- | --- |
| 开场 | 山脊与云层 | 8 秒 | 风声 |
| 行进 | 步道与脚步 | 10 秒 | 脚步与衣物摩擦 |
| 观察 | 叶片与岩石 | 6 秒 | 环境底噪 |
| 收束 | 湖面与波纹 | 6 秒 | 留白与水声 |

## 工作清单

- [x] 建立参考图与分镜说明
- [x] 准备报价预算样例
- [ ] 核对实际场地与天气
- [ ] 采集原始镜头和环境声

## 交付格式

主版本采用 1920 × 1080 横版，另外保留干净的原始素材。所有描述和文件都通过同一 cap 接口读写。

${fence}text
主题：山野短片
目标片长：30 秒
示例报价：6,350 元
用途：工作台功能演示
${fence}

## 为什么放在一个知识树里

简报解释目标，媒体保存证据，数据库记录状态，代码执行可重复的计算。
它们各自有明确的内容结构，通过虚拟路径形成连贯的上下文。
`;

export const calculatorBody = `// 开发样例：按数量和单价计算金额，只使用 Node.js 内置能力。
const [quantityText = "2", priceText = "1200"] = process.argv.slice(2);
const quantity = Number(quantityText);
const unitPrice = Number(priceText);
if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity < 0 || unitPrice < 0) {
  process.stderr.write("数量和单价必须是非负有限数字\\n");
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ sample: true, quantity, unitPrice, total: Math.round(quantity * unitPrice * 100) / 100, currency: "CNY" }, null, 2));
}
`;

export const databaseStatements = [
  { sql: "CREATE TABLE media_assets (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, duration_seconds REAL, media_path TEXT REFERENCES _cap_files(path))" },
  { sql: "CREATE TABLE production_notes (id INTEGER PRIMARY KEY, recorded_at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, media_path TEXT REFERENCES _cap_files(path))" },
  ...[
    ["M001", "山脊远景", "video", "已准备", 8, null],
    ["M002", "步道中景", "video", "待拍摄", 10, null],
    ["M003", "叶片特写", "video", "待拍摄", 6, null],
    ["M004", "湖面参考", "image", "已入库", null, "media/湖面参考.jpg"],
    ["M005", "环境声占位说明", "audio", "待采集", null, null],
    ["M006", "报价预算", "excel", "已准备", null, null],
  ].map((parameters) => ({ sql: "INSERT INTO media_assets VALUES (?,?,?,?,?,?)", parameters })),
  { sql: "INSERT INTO production_notes(recorded_at,level,message,media_path) VALUES (?,?,?,?)", parameters: ["2026-11-12T10:00:00Z", "info", "开发样例初始化，独立媒体文件已入库。", "media/湖面参考.jpg"] },
  { sql: "INSERT INTO production_notes(recorded_at,level,message,media_path) VALUES (?,?,?,?)", parameters: ["2026-11-12T10:05:00Z", "info", "分镜总时长为 30 秒，等待实际拍摄材料。", null] },
  { sql: "INSERT INTO production_notes(recorded_at,level,message,media_path) VALUES (?,?,?,?)", parameters: ["2026-11-12T10:10:00Z", "notice", "此库只包含开发样例，不代表真实生产记录。", null] },
];
