# 本地图形客户端

- 状态：本地工作台开发中。
- 依据：图形入口复用既有客户端能力，视觉沿用VideoSeed的硬塑料表面、短阴影和高对比文字。

## 进程与边界

服务端默认127.0.0.1:5184，客户端图形服务默认127.0.0.1:5183。npm run ui先用esbuild构建browser/依赖入口，再启动本地图形服务。web/包含HTML、CSS及浏览器ES模块，web/vendor/为忽略的本机构建产物，不请求CDN。界面使用本地HTTP桥接访问ApiClient、同步和运行模块，后端规则与CLI共用。

服务端地址和认证配置取自客户端环境变量。浏览器获得显示用serverUrl及当前图形会话csrfToken，服务端Bearer值保留在本地进程。图形服务仅回环监听并核对Host、Origin、会话头，页面资源使用同源CSP。

## 界面接口

- GET /ui/session返回csrfToken与serverUrl。
- POST /ui/action接收action及对应字段，返回既有客户端操作结果。写入必须包含当前cap或位置token，事件和错误回执继续保留。
- GET /ui/content?name=...&entry=...流式提供预览，支持Range。download=1下载原件。
- PUT /ui/upload?name=...&entry=...接收原件字节，携If-Match与X-Capsule-Session；临时保存后通过统一客户端上传，失败清理暂存。

action提供health/list/ls/stat/entries/read/preview/office-write/office-status/office-open/office-session/office-save/table/table-write/history/events/event/create/save/update/query/write/mount/revert/run/sync。Office会话与表格读写复用客户端适配。GET /ui/office/recovery?id=...下载已保留的冲突原件。revert返回入队事件由界面轮询，run仅在用户明确操作后执行。

创建cap和新增挂载是两个明确请求。挂载失败时应说明cap已创建并能从全部cap找回，避免重试创建造成重复或名称冲突。

## 状态与草稿

选择cap和读取文件按请求序号绑定，晚到响应不覆盖其他选择。正文草稿保存读取时的baseToken，后台刷新不替换旧草稿的基线。保存遇409保留正文和基线，由用户重载或合并后提交。

简介草稿同样绑定读取时的token，外部更新不能替换未提交简介的基线。切换内容不隐式保存，离开页面时检查未保存草稿。

## 内容与侧栏

左侧第一列负责虚拟知识结构及类别筛选，知识树在当前位置展开。选中目录cap后，其右侧第二列展开原生文件树，数据库还可切换数据表。中央负责当前内容的阅读、编辑或操作，最右侧负责该内容的上下文和可折叠属性，不重复内部文件导航；版本与运行事件在底部面板查看。亮色与深色主题使用同一布局和类型色，不以模糊或低对比文字表达层级。

- Markdown cap固定README.md与assets/，使用markdown-it解析及DOMPurify清理，支持当前cap内的相对图片、音频和视频嵌入；raw HTML关闭，媒体不跨cap引用。上传默认进入assets/，正文通过编辑保存。普通text继续平铺；已有text不会自动转换。代码提供行号编辑，并可浏览原生文件及显式运行。
- 图片使用独立预览画布，音频与视频使用原生媒体控制，不自动播放。
- Office中央主视图嵌入ONLYOFFICE Docs，直接编辑DOCX/XLSX/PPTX。保存等待cap提交确认，后台刷新保持活跃编辑器。模板和单元格小表单退出主交互，额外的Agent提取与批处理命令保留，见office.md。
- 文件集合显示自身原生条目，SQLite使用Tabulator显示表与分页查询结果，业务单元格可编辑后统一提交。无主键、系统表和自定义查询结果只读。数据库媒体仍通过统一内容接口访问，详见database.md。

ONLYOFFICE脚本、iframe和连接只允许CAPSULE_ONLYOFFICE_URL的固定来源，不加入通配来源或inline/eval。普通Bearer与文档服务JWT密钥不进入浏览器，编辑器配置使用短期票据。编辑器“变化已收集”不作为cap已保存，保存期间继续输入会保留dirty。冲突/失败保持会话并提供恢复原件；明确确认关闭时提醒恢复原件不一定含之后新输入。表格草稿保留原token，切表后仍可恢复；保存期间共享草稿锁定，不能通过切表再切回来覆盖待提交数据。

## 开发示例

演示数据通过独立脚本显式种入服务端，界面读取真实cap，不在浏览器伪造业务记录。样例包含文本、图片、音视频、Word、Excel、文件集合、数据库及可运行代码。现有同名cap不会被种入脚本覆盖，来源与重建方法见[开发示例](demo-data.md)。空库仍显示实际空状态和新建入口。

## 验证

静态检查覆盖浏览器模块。HTTP测试验证静态资源、会话和同源限制、代理凭据、原件流及写入冲突。视觉与交互由用户在打开的工作台验收。
