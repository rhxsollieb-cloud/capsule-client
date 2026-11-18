# CLI对标与职责

本表以VideoSeed的公开CLI帮助、resources分层帮助及业务服务职责为参照，描述当前知识库CLI的覆盖与边界。目标是人在界面与Agent在CLI中使用相同知识库语义，视频创作专用能力另列范围。

## 常用流程

用 `capsule me` 核对身份，按 `capsule help 组或命令` 展开参数。CLI 默认输出 JSON，程序调用可追加 `--json-errors`。正文或 JSON 的文件参数可用 `-` 从标准输入读取，无需额外的转换工具。

查看一本书的根文件和配图目录，分别读取这两级列表：

```sh
capsule entries 原书.md --directory=
capsule entries 原书.md --directory assets --limit 30
```

移动只有一处可见挂载的胶囊时，用全名预演即可。再使用预演返回的 `path` 和子树 `token` 提交，目标末段由父路径与原名称组成。

```sh
capsule move 词形索引.md --into /知识库.md/术语表.md --dry-run
capsule move /知识库.md/摄影.md/词形索引.md --into /知识库.md/术语表.md --token TOKEN
```

多处可见挂载须指定源虚拟路径。预演核对源子树与目标父位置，写权限、目标冲突和原 token 由实际提交校验。大子树可用 `--out` 保留完整范围。

更新导航文字时，先查看精确匹配数和当前版本。预演 `canApply` 为 true 时，用返回的正文 token 提交，只有明确使用 `--all` 才会替换全部匹配。

```sh
capsule edit 摄影.md --old-text 旧导航 --new-text 新导航 --dry-run
capsule edit 摄影.md --old-text 旧导航 --new-text 新导航 --token TOKEN
```

批量移动、挂载和断链把操作写入一个 JSON 数组。管理员用 `--prepare` 取得基线并交给服务端预演，`--out` 保存完整计划，审阅后直接提交该文件。

```sh
capsule organize --prepare operations.json --out plan.json
capsule organize --plan plan.json
capsule organize --receipt RECEIPT
```

批量整理沿用文件中的基线。读到版本冲突时重新核对范围和计划。相同命令的旧格式、预演和回执分页见下文。

## 覆盖表

| 能力 | 当前覆盖 | 边界 |
| --- | --- | --- |
| 连接与登录 | connection/login/logout/password-change、me/whoami | 前端与CLI共用Authentication和ConnectionStore；隐藏输入或密码文件，不保存密码；人和Agent统一账户密码、默认共享同一配置的12h会话与权限，Agent非交互用--password-file文件或- |
| cap创建、导入、概要、正文、原件、详述与清除 | create/import/copy/stat/update/read/put/get/details/write-details/removal/delete | import将一个干净目录流式导入全新cap并形成一次初始提交，copy复制独立实体；均不自动挂载。实体token和挂载token分开；清除预览后入队 |
| 虚拟位置 | ls/mount/position/move/unmount/where | where列出可见挂载；move可从唯一挂载预演，作用于位置子树 |
| 位置批量规划 | organize inspect/prepare/dry-run/apply/receipt | 支持mount/move/unmount按序计划及同一目录事务提交；内容写入各用cap版本 |
| 版本与未知结果 | history/revert/event/events/sync，稳定HTTP错误码和未知结果提示 | 回撤形成新提交；超时、网络中断先核对回执，不自动换基线或重放 |
| 缓存复用 | sync、run及Skill注册共享跨进程缓存锁 | 同提交与完整本地对象复用；新版本可增量下载，changed只表示checkout变化。默认等锁30秒，CACHE_BUSY及异常锁见[缓存架构](architecture.md#同步与运行) |
| 小原件复用 | get、preview及工作台原件共享ETag缓存 | 每次重验当前权限；16MiB单文件、128MiB已登记磁盘LRU，Range和大媒体不整包预取，见[流量说明](content-cache.md) |
| 渐进读取 | read/details行范围，read及正文型details的around/anchor定位，list/entries/query分页，fields/raw/max-chars/out | 大于1MiB的UTF-8原文按完整行有界读取，JSON预算可能提前分页；核对token与nextLine，单行过大明确413，不把摘录当完整正文 |
| 范围查询 | overview/where/search，以及单cap query | 搜索直接读取实际内容/元数据详述，不增加cap内部索引。候选游标与命中数分开 |
| 精确文字修改 | edit、edit --dry-run | 核对全部范围与同一版本，预演报告匹配数量；默认详述可随正文更新简述，显式路径通过原件文本接口写回 |
| 管道输入 | 正文及JSON文件参数接受- | 严格UTF-8，默认最多1MiB，拒绝NUL；二进制原件继续使用流式put/get |
| 人类和机器帮助 | 按组/命令help及help --json | 同一catalog派生arity/options/help/group/handler；未知原型属性不会作为命令 |
| 离线规范说明 | guide、guide data、guide cli、guide skills | 直接按行读取随包文件，保留范围及续读，离线运行 |
| 本机诊断 | doctor/paths | paths不创建目录、不联网，只显示客户端工作区；不返回或猜测远端原件真实文件系统路径 |
| 胶囊活动 | activity 名称 | 只读查询全部未过期会话、未完成事件、Office及队列状态；CLI不按tab排除自身，不注册心跳，会话数不是人数，提示不是锁 |
| 编辑占用 | lease-status/acquire/renew/release及写命令--lease | 与前端共用operations/leases；cap级20秒租约，5秒续期，完成立即释放；原版本token继续校验，见[并发说明](../../capsule-server/docs/concurrency.md) |
| Office与数据库 | 独立Office会话与提取/批处理、SQLite查询/表格写入 | 复用对应业务模块，格式与保存边界由Office及数据库说明维护 |
| Skill | 固定CLI、精确提交运行、本机注册及可选协作界面 | 依赖与工具业务归Skill自身，客户端不假定仅支持Node内置依赖，不自动安装依赖 |
| 员工、权限与审计 | me/whoami/users/user-create/user-update/credentials/credential-create/credential-revoke/cap-access/grants/cap-protect/audit | 账户仅admin/editor；cap统一非管理员read/edit/none，携权限revision；旧个人grant-set停用，不静默扩大为全员授权 |
| 整库备份与恢复 | backups/backup-create/backup-inspect/backup-register/backup-verify/backup-download/backup-restore-preview/backup-restore/backup-receipt | 管理员维护屏障快照、独立校验、外存目录认领及隔离恢复；不自动覆盖运行库或切换服务 |

## 命令与共享操作

src/commands/catalog/按身份连接、胶囊、正文、数据库、位置、版本、Office、Skill、诊断划分声明；每条只有一份名称、参数类型/范围、必需标记、位置参数数量、帮助、组和处理器归属。catalog初始化拒绝重名。specification和help投影同一声明，dispatch只选择业务处理器；跨参数依赖保留在validation。

CLI把位置参数和文件/标准输入转换成规范对象，src/operations/负责发现、位置组织、活动、文字替换和身份协议，BFF复用这些操作。连接、登录、退出、改密优先使用同配置的本机桥接；未发现匹配桥接时才独立调用Authentication，POST发送后的失败不回退重放。Skill管理命令经专门本机通道调用SkillManager；其他知识读写直接调用统一服务端API，不依赖BFF action分发，也不直接修改服务端目录或登记SQLite。服务端负责权限、最终版本校验和持久事务。

connection保存地址，login隐藏交互输入密码或用--password-file文件/stdin；password-change对应当前/新密码文件参数，用户管理通过--username与--password-file设置或重设登录。默认输出不含登录会话令牌；会话保存在当前用户的私有connection.sqlite，前端与Agent CLI默认共用。显式CAPSULE_TOKEN仅为兼容旧脚本保留CLI优先级，whoami返回实际身份；图形工作台忽略该长期令牌。连接路径、密码要求、草稿及外部切换规则见[登录说明](login.md)。

账户只有管理员和普通员工。cap-access读取或携--permission read/edit/none与--revision设置整个cap的非管理员访问，不逐员工授权。grants为读取别名，cap-protect保留布尔兼容映射none/edit；旧grant-set明确拒绝。普通员工可复制任何可读cap为新的独立可编辑cap，源只读不影响复制，源无访问则拒绝。

`capsule help`先列能力组，`capsule help content`或`capsule help read`再展开；追加--json返回机器声明。帮助在解析配置与连接服务前完成，不触发业务初始化。

guide无主题先列索引，data、cli、skills分别读取随包的数据规范、CLI流程和Skill约定。仅白名单主题可读，默认60行，最多200行，按lines.nextLine或next续读。guideVersion标识指南响应格式，scope=client-bundled标明随客户端发布。正文支持raw，--fields保留来源与续读。guide在连接配置加载前离线运行。

## 输入、输出和失败

input.mjs共用文件与标准输入读取，按实际读取字节限制，普通文件预检与流式上限同时执行，UTF-8错误不替换为乱码。文字BOM与换行保留，JSON输入允许BOM。原件put/get仍走流式传输，不受文字输入格式替代。

普通命令用 `--` 结束选项，之后的文字作为位置参数，例如 `capsule stat -- --2026书目.md`。对 `run`，分隔符之后的参数原样传给Skill。整数选项使用十进制。

entries省略--directory时保留旧平铺列表，`--directory=`展开根目录，`--directory assets/子目录`展开相对目录。逐层列表返回kind与commit，续页时核对同一commit，调用服务端已支持的目录接口。

edit先验证分页起止、总行数、承接位置、commit和token，再计算匹配及写入预算。--dry-run返回matches与canApply，原文无匹配、多匹配或替换后的正文超限可从blockedBy区分。预演时可选--token锁定预期版本，正式写入必须传入原token。默认详述可加--description更新简述，两项以同一版本保存。

`import 本地目录 新cap名称 --kind markdown|files|code`通过operations/import归档后流式发送未压缩PAX tar至统一服务端接口，30分钟有界超时，不逐图片提交。markdown目录为README.md和assets/，files为说明.md和assets/，code为含SKILL.md与scripts/cli.mjs的实际Skill目录；导入不执行代码。使用系统tar，Windows可使用系统或Git for Windows附带的tar，不需额外工具链。客户端拒绝链接、特殊文件、运行/凭据目录和不兼容Windows的路径；归档前后核对文件与目录集合、版本签名，变化时在发送前失败。默认最多10000路径、512MiB单文件、2GiB总文件，服务端仍最终校验。目标必须全新，不覆盖、不自动挂载；成功返回标准cap与eventId。结果未知先查目标和原事件，不能重放导入。多个目录分别调用不构成跨cap原子事务。

output.mjs默认JSON不改变小结果结构；字段选择后保留身份与版本/续读，页面预算从末尾减少完整记录并重算游标，正文按整行减少。不能安全分割的结果标记dataOmitted；具备行/候选游标时保留重试起点，不跳过未输出内容。run等结果没有stdout续读游标，不能通过分页取回被省略的输出。必要回执本身过大时整字段省略并记录omittedFields，不切断token或事件ID。read/details与guide主题的--raw输出所选正文，不附JSON或额外换行；超预算报错，不输出半份正文。正文行结束符按读取接口归一化，原件字节应通过get取得。

--out在执行前检查目标不存在，完成后以同目录临时文件和hardlink发布所选字段的完整JSON，不覆盖既有文件、不留半份JSON；它不自动读取剩余页。输出失败不等于业务未执行，应先核对回执。run会尝试把结果保存到client.sqlite，本机日志失败会有logError，不能保证结果已持久化；事前可用--out，不能为取更多stdout重跑有副作用的Skill。

user-create和credential-create可能只返回一次个人凭据，调用前拒绝--fields；显式小于2048字符的输出预算须改用--out或增大预算，避免执行后才遗漏唯一令牌。这两类--out文件以0600模式发布，Windows 则须将输出目录放在当前用户的 NTFS 私有目录，不能把该模式视为已设置 NTFS ACL。成功时stdout只返回文件回执；若签发已完成而保存文件失败，失败回执会保留一次性令牌并提醒立即保存，应按敏感响应处理。不能把输出失败理解为未签发并直接重做。

默认stdout为JSON结果/必要事件回执，stderr为宿主异常诊断。--json-errors在捕获宿主异常时输出机器错误，保留HTTP status、code、eventId及uncertain/unknownResult。Skill子进程非零或logError仍返回普通run回执并非零退出，不自动包装error，也不代表没有执行。已知CAPSULE_TOKEN在配置前参数错误及宿主错误输出中隐藏。run的--之后原样交给Skill，不把Skill的--help或--json-errors当宿主参数。

事件等待错误在已有有效ID时保留eventId：已知failed/conflict透传事件自身error的status/code，保持确定失败；等待超时、轮询失败、无效回执或无效成功结果分别返回EVENT_WAIT_TIMEOUT、EVENT_POLL_FAILED、EVENT_RECEIPT_INVALID、EVENT_RESULT_INVALID，并标记uncertain。最后收到的回执若存在则放在result中，其有效性仍需按错误判断，不能把未知等待结果当作未执行而重放。

## 搜索与组织游标

search的total为经过path/kind/query筛选的候选cap数，offset/nextOffset同样按候选计数；scanned说明本页完成处理的候选范围，returned为当前输出命中数。全局字节预算不足以完成某cap时，该cap的部分摘录不输出，nextOffset保留该候选以便次页重新检查。每cap匹配和位置展示另有上限，matchesTruncated、positionsTruncated、incomplete及其next建议显示实际覆盖边界。incomplete.next是单cap继续核对建议，不是全局游标。`search --query`只筛概要，不展开正文；`search --text`不扫描SQLite原件、媒体或其它二进制内容。

--prepare接受以下操作数组：

```json
[
  {"operation":"mount","name":"书目.md","path":"/书目.md"},
  {"operation":"move","path":"/正文.txt","to":"/书目.md/正文.txt"}
]
```

输出含影响范围和完整plan。按 `--plan 预演文件 --dry-run --offset 偏移` 可续查预演结果，保持原计划与基线。`--plan`也继续接受原始计划对象：

```json
{"version":1,"baseline":"TOKEN","operations":[
  {"operation":"unmount","path":"/旧主题.md/正文.txt"},
  {"operation":"mount","name":"正文.txt","path":"/新主题.md/正文.txt"}
]}
```

dry-run和apply使用同一规划器及基线校验，apply的offset必须为0。提交回执只读续查，不通过重放计划翻页。组织原子性仅涵盖顶层目录SQLite的位置变更，不涉及跨cap Git或正文事务。

## 仍未实现及不适用

整库备份经服务端维护屏障生成catalog、原件、Git和必要恢复资料的一致快照；每cap bundle、本机缓存或单文件下载不能替代它。backup-restore仅生成隔离工作区，生产切换、异机存储、周期调度、自动保留和客户端本机state备份仍由独立运维流程负责，见[备份恢复](../../capsule-server/docs/backups.md)。

copy 源cap 副本名称 --token 源token生成独立原件和新Git历史，不继承挂载或源权限；创建完成后可用mount另行组织。只读源也可复制，无访问源拒绝。未知结果先查询副本及事件，不自动重提；具体见[复制说明](../../capsule-server/docs/copy.md)。尚未实现改名、通用跨cap内容引用登记、来源trace、人工审核/标签系统。where只查挂载，不把挂载推断为来源或共享数据。

视频生成、时间轴组合、混音、模型资产、供应商作业恢复与达芬奇交接属于VideoSeed领域能力，不作为知识库CLI缺口。机器JSON帮助和稳定结构化错误是本项目增强；没有声称VideoSeed已有同名机器接口或所有领域能力均已1:1迁移。
