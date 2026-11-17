# Office网页编辑

工作台主入口使用ONLYOFFICE Docs直接打开、编辑并保存DOCX、XLSX、PPTX原件。编辑器嵌入中央区域，cap继续维护原件、唯一名称、虚拟位置、token与Git版本。Office编辑会话和保存回执由服务端顶层工作区维护，不在cap内增加JSON或登记库。

## 运行与配置

先启动ONLYOFFICE Docs，并按服务端部署说明配置文档服务、JWT密钥及可从编辑服务访问的胶囊服务地址。客户端设置同一个浏览器访问地址：

```sh
CAPSULE_ONLYOFFICE_URL=http://127.0.0.1:8081 npm run ui
```

Windows PowerShell 使用 `$env:CAPSULE_ONLYOFFICE_URL = 'http://127.0.0.1:8081'` 后执行 `npm.cmd run ui`；连接公司远端时优先使用与 CLI 共用的 --env-file，见[Windows 使用说明](windows.md)和[腾讯云连接](tencent-connection.md)。

默认值为http://127.0.0.1:8081。该值需要与服务端返回的editorUrl一致。Office脚本、连接及编辑器iframe限于该固定来源；iframe另允许127.0.0.1和localhost的HTTP回环端口，以承载本机Skill协作页面。工作台自身脚本不启用inline/eval。文档服务未配置或未就绪时，界面显示实际故障、重试及原件下载入口。

普通服务端Bearer和ONLYOFFICE JWT密钥保留在本地进程；浏览器只获得本次编辑器配置及短期原件票据。具体服务端环境与接口维护于[服务端API契约](../../capsule-server/docs/api.md)。

## 编辑与保存

Office配置使用当前员工身份和cap权限。工作台默认以view浏览，不获取编辑占用；有编辑权限时可在标题菜单选择“占用并编辑Office”，取得office共享租约并重开编辑配置。只读员工始终edit:false。纯浏览不阻挡清除或备份；真实编辑会话的关闭仍等待文档服务确认。签名源票据绑定该身份，force-save及最终回调在发布前重查凭据、授权和cap incarnation。撤销或同名重建不能借旧编辑器覆盖新数据；已接收的完整输出保留作恢复材料，实际下载仍需当前授权。员工身份与审计规则见[管理说明](../../capsule-server/docs/access.md)。

选择Office单文件cap或目录cap内的Office条目后，工作台创建绑定读取token的编辑会话。正文、表格、格式和公式由ONLYOFFICE编辑器处理，主界面不再使用占位符表单或单元格地址表单代替Office编辑。

编辑器中文界面由lang指定，它不设置DOCX正文的校对语言。自动拼写检查通过服务端签名配置features.spellcheck默认关闭，避免中文内容按错误词典大面积标红；用户仍可在ONLYOFFICE中选择文档语言并开启校对。此设置不改变原件文字、下划线格式或修订。ONLYOFFICE保存的浏览器校对偏好优先于默认值；已有页面若仍标红，可用编辑器“文件 → 高级设置”关闭“启用拼写检查”，或点击底部拼写检查图标。配置更新在安全地重新打开编辑器时生效，不为此自动重建活跃会话。参数依据见[官方拼写检查配置](https://api.onlyoffice.com/docs/docs-api/usage-api/config/editor/customization/customization-standard-branding#featuresspellcheck)。

点击内容标题行的“保存”（或⌘S / Ctrl+S）后，工作台先等待编辑器收集当前输入，再请求文档服务force-save，并等待服务端确认新原件已沿统一内容接口写入Git。编辑器的“已收集变化”事件不等于cap已保存；保存期间继续输入会继续标为未保存。

同一活跃会话保持固定document.key。force-save产生新Git提交后不销毁或重建编辑器，后台刷新只更新版本与保存状态。结束会话后重新打开才创建或加入符合当前版本的新会话。

切换内容前尝试保存并等待确认。保存失败或冲突时保留当前编辑器；已有服务端恢复原件时提供下载，尚未收到原件时提示先通过编辑器自行下载。用户仍可明确确认关闭未保存会话；服务端恢复文件只代表已经收到的那一版，不保证包含之后继续输入的修改。离开整个页面时仍检查未保存状态。

CLI或其他客户端改动原件后，当前会话继续保留原版本基线；后续保存不能覆盖外部新版本。恢复原件可通过本地桥接GET /ui/office/recovery?id=会话ID下载，入口使用与现有原件读取相同的Host/Origin/Sec-Fetch-Site保护，并由后端Bearer取得文件。

恢复下载流式传输且不进入小原件缓存，读取期限为30分钟；浏览器中止下载会关闭对应上游读取，不使用JSON请求的30秒超时。取消下载不改变Office保存结果或服务端保留的恢复原件。

原生编辑器的保存负责收集内容到文档服务，工作台标题行的“保存”负责确认知识库提交。中间保存回调必须对应当前请求ID，迟到的旧回调不再覆盖新内容。字节未变化的成功保存会推进保存确认序号，但不生成空Git提交。会话超过有效期会明确报错，已有恢复原件仍可下载。

命令网络响应未知时保持原保存请求，查询和等待迟到回执，不自动重发或清除当前修改。重新加入已有编辑房间也先按待确认处理，避免把文档服务缓存中的未提交内容误报为cap已保存。

## Agent与CLI

```sh
node src/cli.mjs office-status
node src/cli.mjs stat 拍摄说明.docx
node src/cli.mjs office-open 拍摄说明.docx --token CURRENT_TOKEN
node src/cli.mjs office-session SESSION_ID
node src/cli.mjs office-save SESSION_ID
node src/cli.mjs office-recovery SESSION_ID ./恢复原件.docx
```

Office-open返回可交给DocsAPI.DocEditor的配置，包含短期票据，仅提供给当前编辑器。office-save是保存请求，调用者继续用office-session核对实际保存状态、saveVersion、result或error；超时先查询，不自动重放。office-recovery拒绝覆盖已有本地目标。

本地桥接action为office-status、office-open（name、可选entry、token）、office-session（id）和office-save（id）。CLI和图形桥接复用src/office/sessions.mjs。

office-open另接受mode:view/edit，CLI默认edit兼容既有用法，纯浏览显式用--mode view。编辑期间使用office范围租约，保存确认、结束编辑或离开时释放；租约失效保留编辑器内容并冻结保存，迟到回调遇到新独占编辑会保留恢复原件。租约与文档服务会话分别管理，见[并发说明](../../capsule-server/docs/concurrency.md)。

## 额外的渐进读取与批处理工具

preview命令继续为Agent提取DOCX文字与表格、XLSX工作表数据，使用Mammoth、ExcelJS及SheetJS兼容读取。它不承担主网页编辑器的渲染。原件最多16MiB，ZIP及XML限制继续适用。

Office原件读取与工作台共用本机ETag缓存，重复预览仍向服务端重新鉴权，但未变字节通过304复用；解析前后仍核对版本，详见[原件缓存与流量](content-cache.md)。ONLYOFFICE Docs自身的文件传输和缓存由文档服务管理，不把本机缓存当作其保存回执。

既有office-write命令保留为显式批处理工具：ExcelJS修改指定单元格，docx填写已有模板中的{{key}}。这些操作有独立token保护与支持边界，不作为Word正文编辑入口。复杂原件不保证完整保真，不支持安全写回的原件明确拒绝。

## 验证入口

单元与跨端测试使用隔离工作区，覆盖会话签名、保存确认、重复和乱序回调、外部版本冲突、恢复原件及队列回撤。真实文档服务启动后，可在同级服务端源码存在的开发环境执行：

```sh
node --env-file=../capsule-server/.local/onlyoffice/runtime.env scripts/onlyoffice-roundtrip.mjs
```

该脚本用真实ONLYOFFICE完成DOCX→ODT→DOCX及XLSX→ODS→XLSX转换，模拟最终签名回调，把转换后的完整原件写入临时cap并执行队列回撤；结束清理隔离测试工作区。它验证真实引擎与持久读写链路，不代替网页输入操作、排版视觉或多人协作体验验收。

## 上游依据

- [ONLYOFFICE打开文件](https://api.onlyoffice.com/docs/docs-api/get-started/how-it-works/opening-file/)：嵌入编辑器与原件读取流程。
- [ONLYOFFICE保存回调](https://api.onlyoffice.com/docs/docs-api/usage-api/callback-handler)：实际新原件、保存状态与force-save。
- [ONLYOFFICE协作会话](https://api.onlyoffice.com/docs/docs-api/get-started/how-it-works/co-editing/)：活跃会话维持document.key。
- [编辑器事件](https://api.onlyoffice.com/docs/docs-api/usage-api/config/events/)：区分输入收集与持久保存。
