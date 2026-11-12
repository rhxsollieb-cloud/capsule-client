# 客户端架构

- 状态：开发中，API v3。
- 依据：服务端顶层元数据、单文件/目录cap与事件队列设计。

## 边界与分层

所有权威读写通过[服务端契约](../../capsule-server/docs/api.md)。CLI和图形工作台使用同一客户端模块，参数呈现、协议、缓存、运行及本地数据库各有职责。

web/维护浏览器呈现和草稿，src/ui/提供本地静态资源与同源桥接。桥接复用ApiClient和现有同步/运行模块，凭据保留在本地进程。图形接口见[ui.md](ui.md)。

src/preview/使用成熟库提供只读Office解析，src/office/负责单元格与模板写回；CLI与图形桥接复用同一入口。处理前限制原件、ZIP条目和展开XML，不另建内容登记库。写回基于读取的原件及token，通过统一上传形成提交；具体保真边界见office.md。

src/database/从SQLite自身读取表结构，适配带主键的业务行操作；SQL仍由服务端node:sqlite执行。浏览器Tabulator网格负责排序、筛选与编辑草稿，保存经共享适配和原有SQL事务入口，不增加内部查询库。browser/仅维护浏览器依赖入口，esbuild生成忽略的web/vendor/供同源加载。

客户端顶层client.sqlite保存每个服务端/cap/提交的元数据快照、当前缓存状态和运行记录。缓存目录保存对应Git对象及原生内容，元数据通过顶层库访问。

## 同步与运行

同步取得服务端提交及该提交元数据，下载精确bundle，核对checkout HEAD后发布缓存记录。失败保持旧缓存可诊断。单文件仓库树只有该文件，目录仓库树就是原生内容。

run仅允许code，从指定提交的原生根构建工作目录，排除.git，读取client.sqlite中对应提交的运行声明，核对缓存与HEAD。通过分离argv执行Node脚本，第三方依赖仍需后续环境准备能力。

实际执行结果、工作位置、stdout/stderr、退出码和日志失败均保存在client.sqlite。--log-cap显式选择数据库cap，经统一write事务记录cap_run_logs。日志失败不自动重新运行工具。

## 单文件与目录

单文件可直接read、put、get和write cap名称，调用者无需附加内部entry。目录型cap显式指定原生相对路径。markdown固定README.md与assets/，省略entry时默认正文；相对媒体引用只在当前cap内解析。query按类别执行文本检索或SQLite查询，内容与位置版本分别校验。

## 回撤

revert携带目标提交及当前token入队，默认等待终态；event和events查询实际状态。成功返回事件与新的cap版本，失败或冲突非零退出。等待超时保留事件ID和已知状态，调用者先查回执。

回撤恢复内容和目标元数据，仍保留后续原历史。虚拟挂载由独立位置操作维护。

## 开发数据

使用干净新格式，取消cap.json读取、分cap state.json、旧runs.sqlite和result.json迁移。检查和测试使用独立临时工作区，运行不依赖服务端源码目录。
