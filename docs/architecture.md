# 客户端架构

- 状态：开发中，API v3。
- 依据：服务端顶层元数据、单文件/目录cap与事件队列设计。

## 边界与分层

胶囊内容、元数据和全库目录的权威读写通过[服务端契约](../../capsule-server/docs/api.md)。本机运行状态与记录由客户端管理。CLI和图形工作台使用同一客户端模块，参数呈现、协议、缓存、运行及本地数据库各有职责。

web/维护浏览器呈现和草稿，src/ui/提供本地静态资源与同源桥接。桥接复用ApiClient和现有同步/运行模块，服务端认证值保留在本地进程。浏览器预览与流媒体经统一HTTP内容接口取用，不等于Git同步，也不自动写入同步缓存。图形接口见[ui.md](ui.md)。

src/commands/catalog/按能力维护唯一命令声明，参数解析、分层帮助和分派由同一目录派生。CLI负责输入与输出，src/operations/维护CLI与本地图形桥接共用的发现、位置组织、活动查询和文字替换操作；权威版本校验和事务仍由服务端完成。help及guide在连接配置解析前执行；guide只读随包文档，其他实际查询与本机Skill通道的区别见[CLI说明](cli-parity.md)。

web/shell.mjs负责按需工具与导航折叠，document-header.mjs管理内容标题、保存状态、活动提示和菜单，tree-actions.mjs提供节点菜单，library-management.mjs编排断链/清除预览及确认。inspector.mjs维护独立属性弹窗、版本与说明草稿，inspector-details.mjs负责分页正文和按需媒体浏览；属性查看不切换中央编辑器，文字只引用已有正文。web/activity.mjs维护可过期的编辑心跳及活动呈现，不替代token或事件回执。Workspace在确认清除且没有同名重建后失效对应请求与视图；删除与回撤分别处理终态。交互规则由[ui.md](ui.md)维护。

src/office/sessions.mjs为CLI和图形桥接提供ONLYOFFICE会话、保存及恢复入口。web/office.mjs维护编辑器生命周期，office-state.mjs单独维护脏状态与保存确认，活跃编辑器不会被后台cap刷新重建。服务端保存回调仍通过统一内容写入及Git提交；具体边界见office.md。src/preview/和其余office批处理模块继续承担Agent渐进提取与显式结构化修改，不再提供主界面模板编辑。

src/database/从SQLite自身读取表结构，适配带主键的业务行操作；SQL仍由服务端node:sqlite执行。浏览器Tabulator网格负责排序、筛选与编辑草稿，保存经共享适配和原有SQL事务入口，不增加内部查询库。browser/仅维护浏览器依赖入口，esbuild生成忽略的web/vendor/供同源加载。

客户端顶层client.sqlite保存每个服务端/cap/提交的元数据快照、当前缓存头、Skill登记和运行记录。缓存目录保存Git对象及原生内容，数据库不存放第二份代码或媒体原件。

## 同步与运行

同步在持锁后取得提交及元数据，校验本地对象，必要时下载bundle，核对checkout后发布缓存记录。单文件仓库树只有该文件，目录仓库树就是原生内容；客户端缓存不按虚拟路径搬动。

缓存按服务端根地址与cap名称隔离。src/cache/lock.mjs先写完唯一claim，再用hardlink原子发布跨进程锁，避免暴露半写身份。同步和运行快照读取共享同一锁；默认最多等待30秒，超时返回409/CACHE_BUSY，不启动另一份同cap传输。取得锁后stat一次，返回提交是本次同步基准，服务端此后仍可能更新。命中缓存仍会联网取得基准并检查完整性，不是离线运行。

同提交命中不下载；本地完整对象已含目标提交时直接复用。校验通过的目标提交保留refs/capsule-cache引用，供历史消费者使用。需要下载时，已有库以通过完整性校验的旧HEAD作base；服务端在有效祖先条件下排除base可达历史，减少旧媒体重复传输，其他情况返回完整包。这不是针对本地全部对象的逐个去重协商。旧服务仅在400/BAD_REQUEST且明确“请求包含不支持的字段”时回退一次无base的只读请求；网络中断、认证及其他错误不自动重试。

下载包广告头必须指向目标提交；已有库先验证bundle前置对象，再导入，Git完整性检查覆盖树和blob。写入Git属性前核对仓库、.git及属性路径不是符号链接，并核对实际工作树。脏工作树、忽略的本机文件、损坏对象，以及偏离本次服务端提交且未登记的本地HEAD均停止同步，保留本机内容。

对象导入、checkout与SQLite发布不是跨介质原子事务。同提交的元数据在BEGIN IMMEDIATE内比较，JSON键序不作为内容变化。发布前失败会尝试恢复已有HEAD，首次发布失败撤回新仓库；恢复失败明确报告并保留现场。SQLite COMMIT已成功而数据库关闭报错时仍非零退出，诊断说明版本已发布，保留新HEAD与登记。已有库导入的有效对象可供重试，首次失败撤回的临时数据和半包不会被当作完整命中。

锁身份包含PID与唯一token，释放时核对身份及文件inode。空锁、非法结构、已退出owner和被替换的锁分别给出CACHE_LOCK_INVALID、CACHE_LOCK_STALE或CACHE_LOCK_CHANGED诊断，保留现场。PID退出不能证明孤儿Git已停，不能仅凭文件年龄或PID不存在自动删锁；先核对所有使用同一缓存的进程和本机改动，再决定处理。

src/cache/snapshot.mjs在同一缓存锁下核对路径、干净工作树、所选元数据和提交，再克隆独立快照；克隆完成后释放缓存锁，之后的checkout和执行不依赖共享HEAD仍停在该提交。Skill注册按cap/commit另加发布锁，锁序为注册版本锁→缓存锁，不反向嵌套。缓存布局不变：

| 本机位置（相对CAPSULE_CLIENT_HOME） | 职责 |
| --- | --- |
| client.sqlite | 版本元数据、缓存头、Skill登记与运行记录 |
| cache/服务端与cap身份哈希/repository | 共享Git对象及受管工作树 |
| skills/身份哈希/versions/commit/snapshot、work | 注册版本快照和可安装依赖的工作副本 |
| skills/身份哈希/state | 跨版本CLI/UI共享的本机持久状态 |
| runs/运行ID/work | 单次run的独立工作副本；临时snapshot在准备/执行结束后移除 |

这些本地副本承担不同生命周期，不等于重复网络下载；不把它们合并为同一可写目录或自动按文件相同清除。实际根目录用paths查询，运行和Skill具体路径以回执为准。

client.sqlite的首次schema检测与建表在BEGIN IMMEDIATE内复查版本，允许多个CLI首次共同初始化；已有v3记录保持原状，未知格式不覆盖。元数据发布及当前缓存头在同一SQLite事务中更新。

run仅允许code Skill，从精确提交构建工作目录，核对所选版本、SKILL.md及固定CLI入口。通过分离argv启动独立CLI，不因工程声明第三方依赖一概拒绝，也不隐式安装依赖。src/skills按格式、注册存储、版本工作区、环境、UI进程与管理编排拆分；workspace.mjs负责工作区发布与Git对象校验，environment.mjs统一移除两项指定凭据，其他宿主环境仍继承。物理路径归src/storage/paths.mjs，协议、环境和生命周期见[skills.md](skills.md)。

客户端尝试把实际执行结果、工作位置、收集到的stdout/stderr、退出码写入client.sqlite；--log-cap显式选择数据库cap记录cap_run_logs。本机或远端日志保存失败会返回logError并非零退出，不保证失败的那份记录已经持久化，也不自动重新运行工具。环境、依赖与直接CLI调用边界由[skills.md](skills.md)维护。

## 单文件与目录

单文件可直接read、put、get和write cap名称，调用者无需附加内部entry。目录型cap显式指定原生相对路径。markdown固定README.md与assets/，省略entry时默认正文；相对媒体引用只在当前cap内解析。query按类别执行文本检索或SQLite查询，内容与位置版本分别校验。

## 回撤

revert携带目标提交及当前token入队，默认等待终态；event和events查询实际状态。成功返回事件与新的cap版本，失败或冲突非零退出。等待超时保留事件ID和已知状态，调用者先查回执。

回撤恢复内容和目标元数据，仍保留后续原历史。虚拟挂载由独立位置操作维护。

## 开发数据

使用干净新格式，取消cap.json读取、分cap state.json、旧runs.sqlite和result.json迁移。检查和测试使用独立临时工作区，运行不依赖服务端源码目录。
