# 工作台开发样例

样例用于查看不同内容的阅读、编辑、媒体播放、表格浏览和本地工具运行。基础脚本创建10个cap，扩展脚本再创建3个，可选Skill示例另创建1个；这些是干净样例库的数量，不代表当前服务端实际总数。主要根虚拟路径为`/示例工作区.md`。计划、报价和记录均为开发样例，不代表真实业务事实。

## 准备与创建

先启动同级服务端，再生成本机原件并种入。生成器使用Codex提供的Node、Python和`@oai/artifact-tool`依赖，以及本机ffmpeg；应用和CLI运行不依赖这些制作工具。

```sh
~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/demo-generate.mjs
node scripts/demo-seed.mjs
node scripts/demo-v2-seed.mjs
```

可用CAPSULE_DEMO_DEPENDENCIES指定制作依赖根、CAPSULE_DEMO_PYTHON指定Python、CAPSULE_DEMO_IMAGE指定图片来源。服务端连接沿用CAPSULE_SERVER_URL与CAPSULE_TOKEN。

生成的原件位于`.local/demo-fixtures/`；表格导出和内部核对材料位于`.local/demo-build/outputs/capsule-ui-demo/`。这些都是本机运行材料，由既有`.local/`规则忽略。源码中的生成器和正文保留以便复现，不把二进制测试数据提交到应用仓库。

种入经统一API完成创建、上传、正文写入、SQL事务和虚拟挂载，每一步沿用响应的新token。脚本不直接写服务端托管目录或catalog.sqlite。首次干净种入时，示例工作区与产品简报使用markdown目录；已存在的早期text样例不会自动转换或覆盖。

demo-v2-seed扩展三个cap：山野手册.md（目录Markdown，独立图片、音频、视频附件）、委托模板.docx（含project、customer、quote占位字段）、预算编辑示例.xlsx（ExcelJS生成，演示单元格写回）。Office网页入口统一使用ONLYOFFICE；Word占位字段也可交给显式office-write批处理。脚本每次会重建本机模板和工作簿fixture，但跳过服务端已有同名cap，不替换其原件。应先成功运行基础脚本，再运行扩展脚本；扩展脚本直接挂载到上述根路径，不自行核验根cap的样例身份。

再次运行时，已有同名cap的正文、原件和版本均保留，不重置用户修改。基础脚本核验根cap的样例description后仍会确保根挂载存在；其他已有cap跳过初始化与挂载，不自动修补缺失内容。若基础脚本遇到非样例同名根cap，则拒绝后续新增挂载；同名用户数据库不接收示例运行日志。初始化中途失败会返回非零并保留已完成内容，应先核对失败位置。

## 内容与用途

团队登录与权限演示还包含“团队协作测试.md”和“管理员记录.md”。前者由editor创建，用来核对所有editor对新cap默认可读写，以及旧token不能覆盖同事提交；后者先创建空正文、开启管理员保护，再写入说明，用来核对列表与原件的权限隔离。保护通过账户与管理或cap-protect设置，不写入cap版本。

本轮测试账户为editor01至editor06，管理员可修改用户名和显示名称。人与Agent都通过相同用户名密码登录；随机初始密码仅保存于维护者本机的私有交接清单，不放入cap、演示正文或Git。

| 名称 | 类别 | 展示内容 |
| --- | --- | --- |
| 示例工作区.md | markdown | 样例导航与来源说明，早期已种入text保持原状 |
| 产品简报.md | markdown | 标题、段落、表格、任务清单和代码段，早期text保持原状 |
| 视觉参考.jpg | image | 湖面参考原图 |
| 提示音.wav | audio | 6秒合成提示音 |
| 演示片段.mp4 | video | 6秒图片缓慢推近和合成音轨 |
| 报价预算.xlsx | excel | 报价预算、分镜计划两张工作表与公式 |
| 拍摄说明.docx | word | 中文说明、标题和镜头表格 |
| 资料包 | files | 说明.md、README.md、CSV和子目录中的正文 |
| 素材记录 | database | 素材、文字日志、自有图片和实际运行日志 |
| 报价计算器 | code | SKILL.md与独立scripts/cli.mjs，无第三方依赖 |
| 山野手册.md | markdown | README.md与assets/下图片、音频、视频 |
| 委托模板.docx | word | 可在网页编辑的Word原件，另含CLI批处理占位字段 |
| 预算编辑示例.xlsx | excel | ExcelJS生成的可修改工作簿，两张表与6350元公式缓存 |

素材记录中的表为`media_assets`、`production_notes`、`_cap_files`、`cap_run_logs`。其中`media_path`通过外键关联数据库cap自有的`media/湖面参考.jpg`。图片上传后成为该cap独立拥有的实体，不与图片cap共享原件。

原报价预算.xlsx保留artifact-tool导出内容，其SpreadsheetML元素使用合法命名空间前缀；ExcelJS不能载入，Agent的preview通过SheetJS兼容读取，office-write拒绝不安全写回。网页主视图仍交由ONLYOFFICE打开、编辑与保存，不受此CLI适配器的只读边界限制。预算编辑示例.xlsx额外展示ExcelJS支持范围内的批量单元格写回，两者不互相替换。各适配器边界见[Office说明](office.md)。

首次创建报价计算器时，脚本实际运行`4 × 1200`得到4800元，并将真实结果写入样例数据库的cap_run_logs。后续重跑种入脚本不会再次运行该工具。

## 来源与验证范围

- 图片复制自同级VideoSeed的`应用/前端/public/demo/lake.jpg`，保留其原有内容；此处没有核实原作者或外部授权信息，也不作来源推断。
- 音频由ffmpeg离线合成440Hz正弦波并淡入淡出；视频由同一图片与该合成音轨离线制作。两者仅供播放器检查。
- Word、Excel、代码、正文和数据库业务数据均为本地编写的开发样例。
- 中文Word生成器显式设置zh-CN校对语言与主题语言，避免继承Python模板的英语/日语标记。已有cap不会因生成器修正被自动覆盖；网页自动校对的默认值和现有浏览器偏好见[Office说明](office.md)。
- Excel生成器断言6350元合计与30秒时长，核对修改数量后合计为7150元，恢复后导出，并生成两张工作表的预览图。扩展工作簿写入6350元公式缓存，后续公式重算由Office编辑器完成。
- Word为真实OOXML原件。既有制作核对覆盖段落、中文正文与表格；bundled LibreOffice曾因中文字体不可用而产生缺字，不能据此确认排版。当前网页渲染由ONLYOFFICE承担，Agent的文字和表格提取不作为排版验证。
- 视频制作为H.264、AAC、960×540、6秒；ffprobe结构核对不代替人工播放体验。
- 种入脚本通过统一API检查实际结果，新建报价计算器后要求演示运行退出码为0。重新生成fixture、种入成功与界面视觉验收是不同结果；视觉、交互和实际播放仍由用户验收。

## Skill 人机协作示例

`node --env-file=.local/ui.env scripts/skill-demo-seed.mjs`从[quote-skill](../examples/quote-skill/SKILL.md)创建“报价协作 Skill”，已有同名cap会跳过内容与挂载。若根cap的description确认为样例，则挂载到示例工作区，否则挂载到`/报价协作 Skill`。注册和启动通过独立skill-register/skill-start操作完成，不由种入脚本隐式执行。页面与独立CLI共用本机SQLite，首次访问初始化12件、单价199元，金额2388元；这仍是开发示例，不代表业务报价。修改源码示例不会自动更新已种入的cap。

若仍有早期通用代码格式的报价计算器，需显式convert-skill转换；原入口作为Skill内部helper保留，固定CLI调用该实现，Git历史继续保留，种入不会自动转换已有cap。新种入的报价计算器直接使用标准Skill骨架和scripts/cli.mjs，作为无需协作页面的纯CLI示例，格式及转换边界见[Skill说明](skills.md)。
