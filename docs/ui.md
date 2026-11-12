# 本地图形客户端

- 状态：基础工作台开发中。
- 依据：用户要求补齐并打开前端，图形入口复用既有客户端能力。

## 进程与边界

服务端默认127.0.0.1:5184，客户端图形服务默认127.0.0.1:5183。npm run ui启动本地图形服务，web/包含HTML、CSS及原生浏览器ES模块。界面使用本地HTTP桥接访问ApiClient、同步和运行模块，后端规则与CLI共用。

服务端地址和认证配置取自客户端环境变量。浏览器获得显示用serverUrl及当前图形会话csrfToken，服务端Bearer值保留在本地进程。图形服务仅回环监听并核对Host、Origin、会话头，页面资源使用同源CSP。

## 界面接口

- GET /ui/session返回csrfToken与serverUrl。
- POST /ui/action接收action及对应字段，返回既有客户端操作结果。写入必须包含当前cap或位置token，事件和错误回执继续保留。
- GET /ui/content?name=...&entry=...流式提供预览，支持Range。download=1下载原件。
- PUT /ui/upload?name=...&entry=...接收原件字节，携If-Match与X-Capsule-Session；临时保存后通过统一客户端上传，失败清理暂存。

action提供health/list/ls/stat/entries/read/history/events/event/create/save/update/query/write/mount/revert/run/sync。save写文本；query按类型执行原生查询；revert返回入队事件由界面轮询；run仅在用户明确操作后执行。

创建cap和新增挂载是两个明确请求。挂载失败时应说明cap已创建并能从全部cap找回，避免重试创建造成重复或名称冲突。

## 状态与草稿

选择cap和读取文件按请求序号绑定，晚到响应不覆盖其他选择。正文草稿保存读取时的baseToken，后台刷新不替换旧草稿的基线。保存遇409保留正文和基线，由用户重载或合并后提交。

媒体、办公原件和正文按实际支持能力展示。办公文件可下载原件，完整语义编辑继续开发。界面不创建演示业务数据，空库显示实际空状态和新建入口。

## 验证

静态检查覆盖浏览器模块。HTTP测试验证静态资源、会话和同源限制、代理凭据、原件流及写入冲突。视觉与交互由用户在打开的工作台验收。
