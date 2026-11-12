# 工作台开发样例

样例用于查看不同内容的阅读、编辑、媒体播放、表格浏览和本地工具运行。根虚拟路径为`/示例工作区.md`，共10个cap。计划、报价和记录均为开发样例，不代表真实业务事实。

## 准备与创建

先启动同级服务端，再生成本机原件并种入。生成器使用Codex提供的Node、Python和`@oai/artifact-tool`依赖，以及本机ffmpeg；应用和CLI运行不依赖这些制作工具。

```sh
~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/demo-generate.mjs
node scripts/demo-seed.mjs
```

可用CAPSULE_DEMO_DEPENDENCIES指定制作依赖根、CAPSULE_DEMO_PYTHON指定Python、CAPSULE_DEMO_IMAGE指定图片来源。服务端连接沿用CAPSULE_SERVER_URL与CAPSULE_TOKEN。

生成的原件位于`.local/demo-fixtures/`；表格导出和内部核对材料位于`.local/demo-build/outputs/capsule-ui-demo/`。这些都是本机运行材料，由既有`.local/`规则忽略。源码中的生成器和正文保留以便复现，不把二进制测试数据提交到应用仓库。

种入经统一API完成创建、上传、正文写入、SQL事务和虚拟挂载，每一步沿用响应的新token。脚本不直接写服务端托管目录或catalog.sqlite。

再次运行跳过全部已有同名cap，保留其正文、原件和版本。脚本不重置数据，也不覆盖用户修改。若根节点同名且不是样例则拒绝新增挂载；同名用户数据库不接收示例运行日志。初始化中途失败会返回非零并保留已完成内容，应先核对失败位置；重跑不会修补已有cap。

## 内容与用途

| 名称 | 类别 | 展示内容 |
| --- | --- | --- |
| 示例工作区.md | text | 样例导航与来源说明 |
| 产品简报.md | text | 标题、段落、表格、任务清单和代码段 |
| 视觉参考.jpg | image | 湖面参考原图 |
| 提示音.wav | audio | 6秒合成提示音 |
| 演示片段.mp4 | video | 6秒图片缓慢推近和合成音轨 |
| 报价预算.xlsx | excel | 报价预算、分镜计划两张工作表与公式 |
| 拍摄说明.docx | word | 中文说明、标题和镜头表格 |
| 资料包 | files | 说明.md、README.md、CSV和子目录中的正文 |
| 素材记录 | database | 素材、文字日志、自有图片和实际运行日志 |
| 报价计算器 | code | 原生main.mjs和package.json，无第三方依赖 |

素材记录中的表为`media_assets`、`production_notes`、`_cap_files`、`cap_run_logs`。其中`media_path`通过外键关联数据库cap自有的`media/湖面参考.jpg`。图片上传后成为该cap独立拥有的实体，不与图片cap共享原件。

首次创建报价计算器时，脚本实际运行`4 × 1200`得到4800元，并将真实结果写入样例数据库的cap_run_logs。后续重跑种入脚本不会再次运行该工具。

## 来源与验证范围

- 图片复制自同级VideoSeed的`应用/前端/public/demo/lake.jpg`，保留其原有内容；此处没有核实原作者或外部授权信息，也不作来源推断。
- 音频由ffmpeg离线合成440Hz正弦波并淡入淡出；视频由同一图片与该合成音轨离线制作。两者仅供播放器检查。
- Word、Excel、代码、正文和数据库业务数据均为本地编写的开发样例。
- Excel已重新计算并核对6350元合计与30秒时长，修改数量后合计变为7150元，恢复后再导出。公式错误扫描无命中，两张工作表均渲染检查。
- Word已生成真实OOXML原件，核对段落、中文正文与表格。尝试的bundled LibreOffice渲染器无法载入系统中文字体，页面有缺字；此项未通过原件视觉核对。工作台提供的是文本和表格预览，不承诺Word排版还原。
- 视频经ffprobe核对为H.264、AAC、960×540、6秒；未把静态检查记为人工播放体验。
- 首次种入创建10个cap，第二次种入全部跳过，代码实际运行退出码为0。界面视觉、交互和实际播放由用户验收。
