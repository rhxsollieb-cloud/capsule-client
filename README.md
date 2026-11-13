# 胶囊知识库客户端

人与Agent共用的胶囊客户端，提供命令行和本地图形工作台。两种入口通过统一API浏览和修改服务端知识，按Git提交号同步胶囊，并在本地运行工具。

- 状态：开发中，API v3客户端，使用干净开发数据。
- 环境：Node.js 24或以上，Git。
- 服务端项目位于同级的`capsule-server/`。

## 安装与连接

```sh
npm install
npm start -- help
```

默认连接`http://127.0.0.1:5184`，先在服务端项目运行`npm start`。需要短命令时可在本项目执行`npm link`，随后使用`capsule`。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| CAPSULE_SERVER_URL | http://127.0.0.1:5184 | 服务端地址 |
| CAPSULE_TOKEN | 空 | 与服务端一致的认证值 |
| CAPSULE_CLIENT_HOME | 安装目录/.local | 本地缓存、工作目录和运行记录 |
| CAPSULE_UI_PORT | 5183 | 本地图形服务监听端口，也是默认客户端通道的端口 |
| CAPSULE_CLIENT_URL | http://127.0.0.1:5183，跟随CAPSULE_UI_PORT | skill-*命令连接的本机HTTP根地址；不改变图形服务监听端口 |
| CAPSULE_ONLYOFFICE_URL | http://127.0.0.1:8081 | 浏览器可访问的ONLYOFFICE Docs根地址，与服务端配置保持一致 |

配置按环境变量传入。默认工作区随客户端安装位置定位；显式设置相对的CAPSULE_CLIENT_HOME时按启动目录解析，跨入口使用同一工作区应配置绝对路径。上传限额等图形服务配置见[界面说明](docs/ui.md)。

## 图形工作台

先在服务端项目运行npm start，再在客户端项目启动界面。

```sh
npm run ui
```

界面地址默认为`http://127.0.0.1:5183`，CAPSULE_UI_PORT可修改端口。界面通过本地回环服务调用现有客户端模块，服务端认证值保存在本地进程；浏览器使用本机会话校验和同源检查。

已生成本机ONLYOFFICE连接配置时，先执行npm run build:web，再用`node --env-file=.local/ui.env src/ui/main.mjs`启动；CLI同样可用`node --env-file=.local/ui.env src/cli.mjs ...`读取本机认证配置。首次部署按[服务端部署说明](../capsule-server/docs/onlyoffice-deployment.md)执行runtime与connect脚本，密钥不需写入源码或命令参数。

工作台沿用VideoSeed的硬塑料视觉风格，支持亮色和深色主题。知识库与目录内容使用双列导航，中央按类型阅读和编辑，属性按需弹出；内容标题承载保存、文件菜单及活动提示。布局、草稿、并发会话、断链和清除规则见[界面说明](docs/ui.md)。

Markdown目录管理正文与自有附件；Office使用自托管ONLYOFFICE Docs网页编辑DOCX/XLSX/PPTX；SQLite业务表使用Tabulator网格。格式和保存边界分别见[数据规范](docs/data-format.md)、[Office网页编辑](docs/office.md)和[数据库表格](docs/database.md)。

`npm run ui`先构建本机浏览器依赖，也可单独执行`npm run build:web`。web/vendor/为忽略的生成物，应用依赖不请求CDN。演示数据由独立脚本显式种入，来源、生成方式及重复执行规则见[开发示例](docs/demo-data.md)。

## Agent入口

Agent通过CLI调用同一客户端，可直接使用node src/cli.mjs，安装短命令后可使用capsule。先查范围，再展开正文；内容修改携当前token，运行代码使用run，回撤使用revert及event查询。名称、虚拟路径和原生entry的区别见[数据规范](docs/data-format.md)。

帮助按capsules/content/database/mounts/versions/office/skills/system分组；`help 组或命令 --json`返回同一命令声明的机器形式。CLI和图形入口复用客户端操作；命令覆盖、输出预算、搜索和批量组织的语义见[CLI说明](docs/cli-parity.md)。

第一次接触胶囊时，先用`guide`列出说明主题，再用`guide data`了解数据模型、`guide skills`了解胶囊Skill与常规Skill的区别。指南直接按行读取本包维护的[数据规范](docs/data-format.md)和[Skill说明](docs/skills.md)，不联网、不解析连接配置、不初始化工作区。续读使用返回的lines.nextLine，也可用--raw取得所选说明正文；它解释本客户端约定，不代表远端实时协商或某个Skill当前状态。

```sh
node src/cli.mjs ls /
node src/cli.mjs help mounts --json
node src/cli.mjs guide
node src/cli.mjs guide skills --from 1 --limit 40 --raw
node src/cli.mjs overview
node src/cli.mjs where 产品说明.txt
node src/cli.mjs read 产品说明.txt --from 1 --limit 20
node src/cli.mjs search / --text 目标文字 --json-errors
node src/cli.mjs activity 产品说明.txt
node src/cli.mjs paths
node src/cli.mjs run 求和工具 -- 2 3
```

guide读取随包说明；health、stat、search、activity等查询实际服务端。activity只读列出全部未过期编辑会话、事件与Office状态，不发送心跳；会话数不是人数，占用提示不替代版本校验。

重复同步复用本地完整提交，跨进程等待同一缓存锁；新版本可通过增量bundle减少旧历史和媒体的重复传输。changed表示本地checkout是否切换，不等于是否下载。缓存、注册Skill和独立运行副本各有生命周期；失败、锁异常和SQLite发布边界见[缓存架构](docs/architecture.md#同步与运行)。

代码Skill使用SKILL.md和独立CLI，协作页面可选且纯本机运行。skill-register/status/start/stop经本机客户端稳定通道管理，Agent CLI与页面共享本机状态；无需协作时直接run，不启动页面。格式、就绪协议、升级及示例见[Skill说明](docs/skills.md)。

## 渐进读取

list查询cap概要，ls展开虚拟位置，entries列举原生内容；read/details分页展开正文与详述。query用于实际文本或SQLite，preview只读提取docx/xlsx并保留提交和截断信息。按响应中的lines.nextLine或nextOffset续读，不把虚拟路径当原件路径。

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

开发依赖中的minimatch通过overrides固定为11.0.1，修复说明见[服务端开发入口](../capsule-server/README.md)。升级工具链时重新核对该覆盖。

接口维护于[服务端API契约](../capsule-server/docs/api.md)，客户端运行经HTTP连接服务端。[架构说明](docs/architecture.md)维护客户端职责，[AGENTS.md](AGENTS.md)维护协作与开发约定。

## 当前边界

运行入口固定Node.js，可使用已准备的依赖并调用本机工具；客户端不自动安装依赖、不提供独立Python运行器或安全沙箱。Office服务、旧格式与数据库可编辑范围见对应说明。完整知识库备份/恢复、cap复制/改名和通用跨cap引用尚无CLI，见[覆盖与边界](docs/cli-parity.md)。

缓存锁异常、未知本地HEAD或脏内容需要先保留并核对；原PID退出不证明孤儿Git已经停止，客户端不自动删锁抢占。处理入口见[同步与运行](docs/architecture.md#同步与运行)。
