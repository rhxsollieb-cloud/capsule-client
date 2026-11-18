# 胶囊知识库客户端

人与Agent共用的胶囊客户端，提供命令行和本地图形工作台。两种入口通过统一API浏览和修改服务端知识，按Git提交号同步胶囊，并在本地运行工具。

- 状态：开发中，API v3客户端，使用干净开发数据。
- 环境：Node.js 24或以上，Git。
- 服务端项目位于同级的`capsule-server/`。

Windows 使用 Node.js 24 与 Git for Windows，在 PowerShell 中运行同一客户端；安装、路径及启动方式见[Windows 使用说明](docs/windows.md)。无需 WSL 或本机 Docker，连接远程 ONLYOFFICE 后可在浏览器编辑 Office。

## 安装与连接

公司同事按[接入与安装说明](docs/team-onboarding.md)使用 GitHub CLI 获取指定分支，或解压管理员提供的精确版本 ZIP。Windows、认领花名和界面登录均有对应步骤；密码随独立员工接入文档交付，不进入源码包。

```sh
npm ci
npm run ui
```

打开终端输出的本机地址，在“连接与登录”中填写知识库服务器、Office 服务地址及管理员分配的用户名密码。员工不需要编辑环境文件；客户端保存连接和12小时有效的登录会话，不保存密码。人和Agent通过前端或CLI使用同一账户登录，默认共用本机配置和权限，先用`node src/cli.mjs me`核对身份。连接、登录与切换见[登录说明](docs/login.md)。

本地开发默认服务端为`http://127.0.0.1:5184`，此时才需要在服务端项目运行`npm start`。连接公司远程服务无需本机服务端。需要短命令时可在本项目执行`npm link`，随后使用`capsule`。

以下环境配置供旧脚本兼容、维护或隔离开发使用；人和Agent的日常连接均通过界面或CLI connection/login完成。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| CAPSULE_SERVER_URL | http://127.0.0.1:5184 | 服务端地址 |
| CAPSULE_TOKEN | 空 | 兼容旧脚本的长期凭据，显式设置时优先于CLI登录会话；图形登录不使用此值，部署管理员凭据仅维护者保管 |
| CAPSULE_LEASE_TOKEN | 空 | Agent当前任务的编辑租约凭证，仅随受保护写入发送，不传给Skill运行环境 |
| CAPSULE_CLIENT_HOME | Windows：%LOCALAPPDATA%\Capsule；其他系统：安装目录/.local | 本地缓存、工作目录和运行记录 |
| CAPSULE_CONFIG_HOME | 当前用户配置目录 | 保存connection.sqlite；未设置时显式CAPSULE_CLIENT_HOME也隔离连接资料，具体路径见登录说明 |
| CAPSULE_UI_PORT | 5183 | 本地图形服务监听端口，也是默认客户端通道的端口 |
| CAPSULE_CLIENT_URL | http://127.0.0.1:5183，跟随CAPSULE_UI_PORT | skill-*命令连接的本机HTTP根地址；不改变图形服务监听端口 |
| CAPSULE_ONLYOFFICE_URL | http://127.0.0.1:8081 | 浏览器可访问的ONLYOFFICE Docs根地址，与服务端配置保持一致 |

本机连接由ConnectionStore管理，前端和Agent CLI默认共用登录会话。CLI显式环境值为兼容旧脚本保留优先级，图形工作台忽略环境中的长期令牌。Windows 默认缓存位于当前用户本地应用目录，其他系统仍随客户端安装位置定位；显式相对CAPSULE_CLIENT_HOME按启动目录解析，跨入口使用同一工作区应配置绝对路径。上传限额等图形服务配置见[界面说明](docs/ui.md)。

连接腾讯云时，API与Office分别使用HTTPS的12090与12091端口，根IP入口保留给ERP；地址和启动方式见[腾讯云连接](docs/tencent-connection.md)。

## 图形工作台

在客户端项目启动界面，首次使用即显示连接与登录入口。

```sh
npm run ui
```

界面地址默认为`http://127.0.0.1:5183`，CAPSULE_UI_PORT可修改端口。界面通过本地回环服务调用现有客户端模块，服务端认证值保存在本地进程；浏览器使用本机会话校验和同源检查。

ONLYOFFICE浏览器地址可在连接页的Office连接设置中修改。服务端维护者首次部署按[服务端部署说明](../capsule-server/docs/onlyoffice-deployment.md)执行，不向员工分发部署环境文件或JWT密钥。旧环境文件仅保留旧脚本或维护用途，普通工作台与Agent使用用户名密码登录会话。

工作台沿用VideoSeed的硬塑料视觉风格，支持亮色和深色主题。知识库与目录内容使用双列导航，中央按类型阅读和编辑，属性按需弹出；内容标题承载保存、文件菜单及活动提示。布局、草稿、并发会话、断链和清除规则见[界面说明](docs/ui.md)。

Markdown目录管理正文与自有附件；Office使用自托管ONLYOFFICE Docs网页编辑DOCX/XLSX/PPTX；SQLite业务表使用Tabulator网格。格式和保存边界分别见[数据规范](docs/data-format.md)、[Office网页编辑](docs/office.md)和[数据库表格](docs/database.md)。

`npm run ui`先构建本机浏览器依赖，也可单独执行`npm run build:web`。web/vendor/为忽略的生成物，应用依赖不请求CDN。演示数据由独立脚本显式种入，来源、生成方式及重复执行规则见[开发示例](docs/demo-data.md)。

## 员工与管理入口

在知识库cube菜单打开“连接与登录”或“账户与管理”。管理员可创建员工、修改登录名和显示名称、重设密码、管理会话及兼容凭据、统一设置cap的非管理员访问档位、查询审计，以及创建、校验、下载和隔离恢复整库备份。界面和CLI复用src/operations/admin.mjs及服务端统一API，管理资料放服务端顶层SQLite，不写入cap。

```sh
node src/cli.mjs me
node src/cli.mjs help admin --json
node src/cli.mjs users
node src/cli.mjs cap-access 公司手册.md
node src/cli.mjs audit --name 公司手册.md --limit 30
node src/cli.mjs backup-create --label 上线前备份
node src/cli.mjs backups
```

人和Agent使用同一套用户名密码登录，CLI与工作台默认共用本机保存的12小时会话和账户权限。账户分管理员和普通员工（editor）；管理员为每个cap设置全体非管理员统一的读写、只读或无访问，新cap默认读写，不再逐员工授权。只读允许下载、复制为新cap后编辑。权限设置携revision，正文仍使用原token，多处挂载不扩大权限。详见[登录与身份](docs/login.md)。

backup-restore必须先预演并核对确认字段，仅在服务端受控恢复区新建隔离库；结果未知用原restoreId查询。恢复库旧登录会话及兼容长期凭据会撤销，密码需要重新设置，旧Office会话过期，不自动切换活动服务。原目录库丢失时可用backup-register按外存SHA-256认领备份目录后恢复。

初始化、权限和兼容凭据用法见[员工身份与审计](../capsule-server/docs/access.md)，备份覆盖、维护窗口及灾难恢复见[整库备份恢复](../capsule-server/docs/backups.md)。企业SSO、MFA和邮件密码找回尚未实现。

此管理入口需要配套更新并重启服务端与本机客户端桥接进程；先保存正在编辑的内容。单独刷新网页不会加载Node进程的新接口，me不可用时界面禁用写入并提示核对版本，不退回匿名管理员。

## Agent入口

Agent通过CLI调用同一客户端，可直接使用node src/cli.mjs，安装短命令后可使用capsule。先执行login或使用同一配置已有会话，非交互用--password-file文件或-读取密码，不传明文密码argv。会话和前端一样12小时到期，先用me核对身份，再查范围、展开正文；内容修改携当前token，运行代码使用run，回撤使用revert及event查询。名称、虚拟路径和原生entry的区别见[数据规范](docs/data-format.md)。

帮助按auth/capsules/content/database/mounts/versions/office/skills/system/admin/leases分组；`help 组或命令 --json`返回同一命令声明的机器形式。CLI和图形入口复用客户端操作；命令覆盖、输出预算、搜索和批量组织的语义见[CLI说明](docs/cli-parity.md)。

第一次接触胶囊时，先用`guide`列出说明主题，再用`guide data`了解数据模型、`guide skills`了解胶囊Skill与常规Skill的区别。指南直接按行读取本包维护的[数据规范](docs/data-format.md)和[Skill说明](docs/skills.md)，不联网、不解析连接配置、不初始化工作区。续读使用返回的lines.nextLine，也可用--raw取得所选说明正文；它解释本客户端约定，不代表远端实时协商或某个Skill当前状态。

```sh
node src/cli.mjs ls /
node src/cli.mjs help mounts --json
node src/cli.mjs guide
node src/cli.mjs guide skills --from 1 --limit 40 --raw
node src/cli.mjs overview
node src/cli.mjs where 产品说明.txt
node src/cli.mjs read 产品说明.txt --from 1 --limit 20
node src/cli.mjs read 完整书稿.md --around 2000000 --limit 240
node src/cli.mjs read 完整书稿.md --anchor chapter-100 --limit 240
node src/cli.mjs search / --text 目标文字 --json-errors
node src/cli.mjs activity 产品说明.txt
node src/cli.mjs paths
node src/cli.mjs run 求和工具 -- 2 3
```

guide读取随包说明；health、stat、search、activity等查询实际服务端。activity只读列出全部未过期编辑会话、事件与Office状态，不发送心跳；会话数不是人数，占用提示不替代版本校验。

实际编辑使用独立的cap租约，浏览不占用，保存、结束编辑或离开立即释放；失联后20秒到期。Agent跨多条命令修改时使用lease-acquire/renew/release，以--lease或CAPSULE_LEASE_TOKEN携证明，仍须保留原正文token。完整用法、Office共享模式及异常磁盘锁处理见[并发说明](../capsule-server/docs/concurrency.md)。

重复同步复用本地完整提交，跨进程等待同一缓存锁；新版本可通过增量bundle减少旧历史和媒体的重复传输。changed表示本地checkout是否切换，不等于是否下载。缓存、注册Skill和独立运行副本各有生命周期；失败、锁异常和SQLite发布边界见[缓存架构](docs/architecture.md#同步与运行)。

CLI get、Office预览和工作台小原件共用有界原件缓存，每次条件重验身份及ETag，未变字节不重复下载；大媒体继续流式Range读取。后台纯查询暂停、未变详述不重取，租约与保存确认继续运行。容量、回收和计数验证见[原件缓存与流量](docs/content-cache.md)。

代码Skill使用SKILL.md和独立CLI，协作页面可选且纯本机运行。skill-register/status/start/stop经本机客户端稳定通道管理，Agent CLI与页面共享本机状态；无需协作时直接run，不启动页面。格式、就绪协议、升级及示例见[Skill说明](docs/skills.md)。

## 渐进读取

list查询cap概要，ls展开虚拟位置，entries列举原生内容；read/details分页展开正文与详述。query用于实际文本或SQLite，preview只读提取docx/xlsx并保留提交和截断信息。按响应中的lines.nextLine或nextOffset续读，不把虚拟路径当原件路径。

大书可用read的--around行号或--anchor精确ID由服务端定位，避免逐页下载前文；与--from互斥，返回范围从实际安全起点开始，代码块和表格不从中间截断。CLI支持安全整数范围内的行号，找不到锚点或结构过大时明确返回诊断。需要配套更新并重启服务端与本机桥接进程。

输出默认预算12000字符，可用--fields、--max-chars或--out控制；read/details及guide主题正文支持--raw。正文与JSON文件参数接受`-`作为标准输入。truncated/dataOmitted代表省略，超长单行和搜索候选页的续读限制见[CLI说明](docs/cli-parity.md)。宿主异常可用--json-errors取得机器诊断；Skill非零退出仍返回run回执，不能视为未执行。

## 创建与写入

```sh
node src/cli.mjs create 工具 --description 工具入口
node src/cli.mjs mount 工具 /工具
node src/cli.mjs create 求和工具 --kind code
node src/cli.mjs stat 求和工具
```

创建code会生成标准Skill骨架。准备一个本地`cli.mjs`替换其独立CLI。

```js
console.log(process.argv.slice(2).map(Number).reduce((sum, value) => sum + value, 0));
```

复制stat响应的token作为下条命令的TOKEN参数。

```sh
node src/cli.mjs put 求和工具 scripts/cli.mjs ./cli.mjs --token TOKEN
node src/cli.mjs mount 求和工具 /工具/求和工具
node src/cli.mjs history 求和工具
node src/cli.mjs sync 求和工具
node src/cli.mjs run 求和工具 -- 2 3
```

每次内容修改在原胶囊内形成新Git提交。再次运行时，客户端取得服务端当前提交，同步并核验后执行。run输出实际提交、退出码、stdout和stderr，工具失败时CLI返回非零。

Git对象和缓存原件位于cache/，版本元数据、缓存头、Skill登记和运行记录由顶层client.sqlite维护。run从所选提交的独立work副本启动固定CLI，使用持久state；它不复用注册work中的依赖。工作目录、环境和直接CLI调用的区别见[Skill说明](docs/skills.md)。

## 目录导入与大书阅读

```sh
node src/cli.mjs import /本地/书稿目录 完整书稿.md --kind markdown --description 书稿与配图
node src/cli.mjs import /本地/Skill目录 书籍处理 --kind code
```

Markdown目录必须包含README.md，配图等自有原件位于assets/；files目录使用说明.md与assets/；code目录包含有效SKILL.md和scripts/cli.mjs。导入前准备干净目录，不包含.git、.env、依赖或本机运行材料。客户端检查来源、创建本机临时未压缩PAX归档、流式上传，服务端一次创建独立cap及初始提交；不覆盖已有名称、不自动挂载或运行。需要系统tar（Windows可使用系统或Git附带版本）；最多2GiB、10000文件，单文件512MiB。具体布局与失败恢复见[导入契约](../capsule-server/docs/import.md)，未知结果先查询目标与原事件，不重放导入。

工作台对长文字分页呈现，只渲染当前段及其图片，并支持行号跳转；只在完整载入且满足编辑预算时进入编辑，截断段不能直接保存。Markdown支持经过消毒的原书表格和锚点；附件始终限定当前cap。正文read/details按服务端nextLine续读，大文件本身不限1MiB，单次JSON仍有1MiB预算。全局搜索与query维持原有扫描边界，不能据此宣称已检索全书。

## 单文件与元数据

单文件可直接按名称get/put；目录型内容使用原生entry。CLI create默认text，图形新建默认Markdown，两者均可显式选kind。Markdown、SQLite媒体区、统一详述来源和Skill形态见[数据规范](docs/data-format.md)，不在cap内建立第二份登记。

## 版本、位置与清除

```sh
node src/cli.mjs history 产品说明.txt
node src/cli.mjs revert 产品说明.txt TARGET_COMMIT --token CURRENT_TOKEN
node src/cli.mjs event EVENT_ID
node src/cli.mjs events --status conflict
node src/cli.mjs stat 产品说明.txt --commit OLD_COMMIT
```

revert入队后等待终态，返回事件及结果。回撤恢复目标内容与对应元数据，并生成新提交。历史stat没有可写token，新的写入应使用当前stat结果。等待超时保留事件ID，先查询状态再决定后续操作。

位置修改使用position取得的子树token，卸载叶挂载保留胶囊内容；批量位置组织先用organize预演。整cap清除先用removal核对范围与阻止原因，再携实体token和mountsToken提交delete；清除不能通过revert恢复，详见[数据规范](docs/data-format.md#写入组织与回撤)。

```sh
node src/cli.mjs position /工具/求和工具
node src/cli.mjs unmount /工具/求和工具 --token POSITION_TOKEN
```

## 数据库、媒体与日志

数据库仅支持SQLite，业务行、日志与自有media/通过统一接口管理，_cap_files由媒体服务维护。SQL、表格草稿与媒体外键规则见[数据库说明](docs/database.md)，具体参数以help为准。

`run 名称 --log-cap 数据库名称 -- 参数`显式将结果写入cap_run_logs。客户端也尝试保存本机运行记录；本机或远端日志失败均有logError并非零退出。保留实际运行回执、ID与目录核对结果，不能为了补日志重新执行工具。

## 开发

```sh
npm run check
npm test
```

check执行ESLint检查。单元测试使用隔离缓存，跨项目集成测试启动真实服务端，验证HTTP、CLI、Git同步和工具升级运行。成功默认静默，失败、跳过和警告可见。

集成测试默认查找同级`capsule-server/`，也可通过`CAPSULE_SERVER_ROOT`指定。缺少服务端源码时该项明确跳过，其余客户端测试仍可执行。

前端交互使用独立的 Playwright Chromium 测试集：首次执行 `npm run test:e2e:install` 安装浏览器，再执行 `npm run test:e2e`；`npm run test:e2e:editing` 单独运行正文、数据库、属性和Office编辑场景。它启动隔离的真实服务端和本机工作台，缺少服务端源码时明确失败；失败截图与 trace 留在忽略的本机目录。运行、Office 服务替身及 CI 范围见[前端测试说明](docs/ui-testing.md)。

开发依赖中的minimatch通过overrides固定为11.0.1，修复说明见[服务端开发入口](../capsule-server/README.md)。升级工具链时重新核对该覆盖。

接口维护于[服务端API契约](../capsule-server/docs/api.md)，客户端运行经HTTP连接服务端。[架构说明](docs/architecture.md)维护客户端职责，[AGENTS.md](AGENTS.md)维护协作与开发约定。

## 当前边界

运行入口固定Node.js，可使用已准备的依赖并调用本机工具；客户端不自动安装依赖、不提供独立Python运行器或安全沙箱。Office服务、旧格式与数据库可编辑范围见对应说明。整库备份恢复已有管理员接口，恢复仅生成隔离库；cap改名、通用跨cap引用、自动部署切换和周期备份仍未提供，见[覆盖与边界](docs/cli-parity.md)。

缓存锁异常、未知本地HEAD或脏内容需要先保留并核对；原PID退出不证明孤儿Git已经停止，客户端不自动删锁抢占。处理入口见[同步与运行](docs/architecture.md#同步与运行)。
