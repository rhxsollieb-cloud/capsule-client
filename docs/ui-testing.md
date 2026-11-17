# 前端交互测试

Playwright 使用真实 Chromium 测试左侧选择、右侧阅读、内部目录、数据库、Office 加载、编辑与登录状态，并覆盖过滤、导航折叠与调宽、两标签页编辑占用及释放、版本历史和队列回撤。测试代码在 test/e2e/，测试结果与普通 Node 单元测试分别报告，不把 HTTP 成功视为界面已经显示内容。

## 本机运行

需要 Node.js 24 或以上、Git、客户端与兼容版本的 capsule-server 源码。默认查找同级服务端，也可用 CAPSULE_SERVER_ROOT 指定源码绝对路径。两端先完成 npm ci；服务端源码或依赖缺失时 test:e2e 会明确失败，不跳过。

```sh
npm ci
npm run test:e2e:install
npm run test:e2e
```

Windows PowerShell 将 npm 写为 npm.cmd。这组脚本使用 Playwright 的 Windows 入口，不依赖 bash 或 shell 通配符。首次 install 下载当前锁定 Playwright 版本对应的官方 Chromium；之后测试复用本机浏览器缓存。

可缩小测试范围或在有界面的模式运行：

```sh
npm run test:e2e -- --grep 登录
npm run test:e2e:editing
npm run test:e2e -- --headed
npm run test:e2e:report
```

测试配置固定最多两个 worker。每个 worker 启动一次隔离服务端，用临时 SQLite、Git、随机端口和假的账号、文档、图片与业务表；每个测试使用独立本机桥接与 ConnectionStore，默认未登录。它不读取公司连接配置，不使用腾讯云或员工的真实账户，也不占用开发工作台端口。共享种子用于阅读测试；写入、冲突等测试应创建该测试专属 cap，避免改变其他用例的基准内容。

等待以界面状态或实际回执为准，不添加固定休眠；操作最长等待8秒，页面导航15秒，每例总上限45秒。断线、迟到响应和版本冲突用例仅在指定请求处注入故障、延迟或冻结旧元数据，保存仍由真实服务端校验。占用释放在5秒内查询实际租约清空并验证另一个标签页可编辑，不等待租约自然过期。所有标签页的未处理JavaScript异常都会使对应测试失败。

## 编辑场景

测试按正文、数据表和属性的用户流程分文件维护：

- `text-editing.spec.mjs`：逐段中文输入、换行缩进、跨平台保存快捷键与刷新验证；资料包内切换文件保留草稿；预览后放弃不产生提交；网络失败后切换再回来、显式重试；保存回执迟到期间编辑另一文档；两个独立客户端使用不同 editor 账户完成占用、保存与交接。
- `database-editing.spec.mjs`：双击单元格修改文字与数字，保护主键；Enter 确认、Escape 取消、放弃修改；跨表草稿隔离，核对实际 SQLite 值、新提交和释放占用。
- `properties-editing.spec.mjs`：简述与 Markdown 详述的编辑、预览、保存和刷新；文字类属性进入同一正文编辑；关闭并切换节点后保留草稿、避免自动保存和串用；关闭期间同事提交新版后，旧草稿保存冲突并保留完整输入。
- `editing.spec.mjs`：基础保存、旧版本冲突完整草稿保护、标签页占用与队列回撤。
- `office-editing.spec.mjs`：明确标注的Office协议替身，验证编辑后等待签名回调才确认版本、保存被拒绝后取消离开保留编辑器、同事提交后迟到回调进入冲突恢复下载。

浏览器未保存草稿只保证当前页面存活期间的切换与重开；持久化核对在明确保存后执行刷新，不将页面重载前的草稿声明为已备份。写入用例既验证浏览器呈现，也通过统一接口核对持久内容和版本；取消/预览会核对没有生成新提交。独立协作客户端的连接目录、身份和本机端口分别隔离。

## Office 边界

Office 测试使用独立本机 HTTP 服务替身提供 health、command、api.js 和 iframe；客户端自己的登录、权限、Office 会话及内容接口仍由真实服务端处理。替身明确标为“Office 测试替身”，用于验证脚本加载、就绪、iframe、失败诊断、重新打开和切换期间的上下文保护。协议替身的输入框触发修改/收集事件，生成合成DOCX原件并用测试专用密钥签名回调；保存由真实服务端核对版本、持久化与提供冲突恢复原件。每例开始前等待旧回调并清空替身状态，只访问隔离回环服务。

这不代表 ONLYOFFICE Docs 的真实排版、公式计算、文件兼容或编辑回写已经验收。已有 Node 集成测试核对源文件、签名回调、版本保护与回撤；真实文档服务和人工视觉验收分别记录。

## 结果与持续集成

失败时截图及 trace 保存在 .local/playwright/results，HTML 报告位于 .local/playwright/report。成功用例不录制视频或保留 trace；测试目录按忽略规则留在本机。报告包含隔离测试的数据和请求，提交源码时不要添加这些运行产物。

默认 GitHub 检查执行 Windows/Ubuntu 的静态检查与 Node 测试，不代表浏览器用例已经执行。需要在 workflow_dispatch 中明确启用 run_e2e，选择兼容的 server_ref，并配置仅供读取私有 capsule-server 源码的 CAPSULE_SERVER_READ_TOKEN secret。未启用时浏览器 job 显示跳过；启用但缺少该 secret 时明确失败并报告未执行，不把基础设施缺失显示为测试通过。凭据原文不进入 workflow 文件。

浏览器 CI 使用 Node 24、独立的客户端与服务端 checkout、官方 Chromium，并仅在失败时上传诊断。本地执行成功与远程 CI 成功分别说明，新增配置不会自动触发发布或修改公司数据。
