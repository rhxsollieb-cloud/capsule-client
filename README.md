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
| CAPSULE_CLIENT_HOME | 项目.local | 本地缓存、工作目录和运行记录 |
| CAPSULE_ONLYOFFICE_URL | http://127.0.0.1:8081 | 浏览器可访问的ONLYOFFICE Docs根地址，与服务端配置保持一致 |

配置按环境变量传入。客户端路径根据项目目录定位，与命令当前目录无关。

## 图形工作台

先在服务端项目运行npm start，再在客户端项目启动界面。

```sh
npm run ui
```

默认打开地址为`http://127.0.0.1:5183`，CAPSULE_UI_PORT可修改界面端口。界面通过本地回环服务调用现有客户端模块，服务端认证值保存在本地进程。浏览器的会话校验和同源检查保护写入、上传及工具运行入口。

已生成本机ONLYOFFICE连接配置时，先执行npm run build:web，再用`node --env-file=.local/ui.env src/ui/main.mjs`启动；CLI同样可用`node --env-file=.local/ui.env src/cli.mjs ...`读取本机认证配置。首次部署按[服务端部署说明](../capsule-server/docs/onlyoffice-deployment.md)执行runtime与connect脚本，密钥不需写入源码或命令参数。

工作台沿用VideoSeed的硬塑料视觉风格，支持亮色和深色主题。知识库占第一列；选中目录cap后，第二列展开其原生文件，数据库可切换数据表与文件。中央按类型阅读、编辑和播放内容，最右侧显示上下文与可折叠属性。版本与回撤事件在底部查看。

Markdown目录保存README.md和assets/附件，使用markdown-it与DOMPurify呈现同cap内的图片、音频和视频。新建默认为Markdown，普通text继续单文件保存。

Office主入口使用自托管ONLYOFFICE Docs，直接在网页打开、编辑和保存DOCX、XLSX、PPTX原件。保存通过统一内容接口、原token和Git版本保护，活跃编辑会话不随后台刷新重建；冲突时保留编辑内容及恢复原件。数据库使用Tabulator网格与服务端官方SQLite驱动，支持保留草稿的单元格编辑。具体运行和保存边界见[Office网页编辑](docs/office.md)与[数据库表格](docs/database.md)。

开发示例通过独立脚本种入，基础十个节点加目录Markdown、Word模板和可修改预算三个扩展示例。样例来源、生成方式及重复执行规则见[开发示例](docs/demo-data.md)。

图形入口与浏览器模块分别位于src/ui/和web/。npm run ui自动构建本机依赖包，浏览器不请求CDN；也可单独执行npm run build:web。构建源码在browser/，生成的web/vendor/不纳入Git。接口边界见[图形客户端说明](docs/ui.md)。

## Agent入口

Agent通过CLI调用同一客户端，可直接使用node src/cli.mjs，安装短命令后可使用capsule。读取优先ls、stat、read和query，写入携当前token，运行代码使用run，回撤使用revert及event查询。

```sh
node src/cli.mjs ls /
node src/cli.mjs read 产品说明.txt --from 1 --limit 20
node src/cli.mjs run 求和工具 -- 2 3
```

运行时先同步并核验指定Git提交，随后在客户端本地工作目录执行，记录进入client.sqlite。Agent也可在本地代码中复用ApiClient和运行模块。

## 渐进读取

```sh
node src/cli.mjs health
node src/cli.mjs list
node src/cli.mjs list --kind database
node src/cli.mjs ls /
node src/cli.mjs stat 工具
node src/cli.mjs entries 工具
node src/cli.mjs read 工具 --from 1 --limit 20
node src/cli.mjs preview 拍摄说明.docx
node src/cli.mjs preview 资料包 office/预算.xlsx
```

list按类别分页查询cap概要，ls展开虚拟位置，entries列举原生内容。单文件可直接read名称，目录指定相对路径。query处理文本或SQLite查询，write处理文本或数据库事务，输出保留范围和续读位置。preview只读解析docx/xlsx，并返回实际提交号与截断状态。

## 创建与写入

```sh
node src/cli.mjs create 工具 --description 工具入口
node src/cli.mjs mount 工具 /工具
node src/cli.mjs create 求和工具 --kind code --engine node --entry main.mjs
node src/cli.mjs stat 求和工具
```

准备一个本地`main.mjs`。

```js
console.log(process.argv.slice(2).map(Number).reduce((sum, value) => sum + value, 0));
```

复制stat响应的token作为下条命令的TOKEN参数。

```sh
node src/cli.mjs put 求和工具 main.mjs ./main.mjs --token TOKEN
node src/cli.mjs mount 求和工具 /工具/求和工具
node src/cli.mjs history 求和工具
node src/cli.mjs sync 求和工具
node src/cli.mjs run 求和工具 -- 2 3
```

每次内容修改在原胶囊内形成新Git提交。再次运行时，客户端取得服务端当前提交，同步并核验后执行。run输出实际提交、退出码、stdout和stderr，工具失败时CLI返回非零。

缓存提交、元数据快照和运行记录统一保存在客户端工作区的client.sqlite。工具从同步提交的原生根目录运行，运行声明取自该提交绑定的顶层元数据。当前开发阶段退出旧JSON状态和日志迁移逻辑，使用干净工作区。

## 单文件与元数据

```sh
node src/cli.mjs create 产品说明.txt --kind text --body ./说明.txt
node src/cli.mjs read 产品说明.txt
node src/cli.mjs put 产品说明.txt ./修订说明.txt --token TOKEN
node src/cli.mjs get 产品说明.txt ./下载说明.txt
node src/cli.mjs update 产品说明.txt --description 修订说明 --token CURRENT_TOKEN
```

单文件直接位于服务端capsules/。files、database、code、markdown使用独立目录。markdown默认正文README.md，附件位于assets/；其他目录的默认正文仍为说明.md。code的update可设置--engine node与--entry，元数据修改会形成新提交。已有text不自动转换，创建Markdown目录请指定--kind markdown。

## 排队回撤

```sh
node src/cli.mjs history 产品说明.txt
node src/cli.mjs revert 产品说明.txt TARGET_COMMIT --token CURRENT_TOKEN
node src/cli.mjs event EVENT_ID
node src/cli.mjs events --status conflict
node src/cli.mjs stat 产品说明.txt --commit OLD_COMMIT
```

revert入队后等待终态，返回事件及结果。回撤恢复目标内容与对应元数据，并生成新提交。历史stat没有可写token，新的写入应使用当前stat结果。等待超时保留事件ID，先查询状态再决定后续操作。

## 数据库、媒体与日志

```sh
node src/cli.mjs create 运行资料 --kind database
node src/cli.mjs stat 运行资料
node src/cli.mjs write 运行资料 --sql 'CREATE TABLE events(id INTEGER PRIMARY KEY, message TEXT, media_path TEXT REFERENCES _cap_files(path))' --token TOKEN
node src/cli.mjs put 运行资料 media/现场.mp4 ./现场.mp4 --token CURRENT_TOKEN
node src/cli.mjs query 运行资料 --sql 'SELECT path,size FROM _cap_files' --limit 20
node src/cli.mjs write 运行资料 --sql 'INSERT INTO events(message,media_path) VALUES (?,?)' --params '["现场记录","media/现场.mp4"]' --token CURRENT_TOKEN
node src/cli.mjs get 运行资料 media/现场.mp4 ./下载的现场.mp4
node src/cli.mjs run 求和工具 --log-cap 运行资料 -- 2 3
```

每次写入后使用响应中的新token，示例中的CURRENT_TOKEN表示当前版本。数据库仅支持SQLite。业务表保存文本日志和媒体关联，_cap_files由媒体管理接口维护。媒体保存在该数据库cap的自有文件区，上传和下载使用流式传输。带外键的日志引用会阻止删除仍被使用的媒体。

run的--log-cap显式选择数据库，将结果写入cap_run_logs表。日志写入失败会返回可见诊断并保留本地实际运行记录，调用者可按运行ID查询，避免重新执行工具。

query和write的SQL参数由--params传JSON数组或命名参数对象。批量事务可用write --file指定内容为SQL语句对象数组的JSON文件，text/code等类别可用query --text检索、write --entry及--body修改文本。具体语法见分层帮助和[API契约](../capsule-server/docs/api.md)。

位置修改使用position取得的位置token。卸载位置保留胶囊内容。

```sh
node src/cli.mjs position /工具/求和工具
node src/cli.mjs unmount /工具/求和工具 --token POSITION_TOKEN
```

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

当前提供CLI和图形工作台、按类别的统一读写和SQLite查询、独立缓存及Node内置模块脚本运行。Office网页编辑需要ONLYOFFICE Docs服务，支持DOCX/XLSX/PPTX；旧DOC/XLS/PPT暂保留明确诊断和原件下载。preview与office-write继续作为独立的Agent提取和批处理工具。数据库网格编辑限有完整非NULL主键的业务表，SQL查询结果只读。带第三方依赖的工具会给出环境诊断。Python运行环境和工具依赖安装继续按需求扩展。

异常终止留下的缓存锁会明确给出位置。先停止使用同一缓存的客户端进程，核对原持有者已退出，再移除该锁文件重试。脏缓存中的修改需要先保留并核对。
