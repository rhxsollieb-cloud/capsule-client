# 胶囊知识库客户端

人与Agent共用的胶囊客户端。通过统一API浏览和修改服务端知识，按Git提交号同步胶囊，并在本地工作目录运行工具。

- 状态：开发中，首个可运行CLI版本。
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

配置按环境变量传入。客户端路径根据项目目录定位，与命令当前目录无关。

## 渐进读取

```sh
node src/cli.mjs health
node src/cli.mjs list
node src/cli.mjs ls /
node src/cli.mjs stat 工具
node src/cli.mjs entries 工具
node src/cli.mjs read 工具 说明.md --from 1 --limit 20
```

list分页查询胶囊概要，ls展开当前虚拟位置，entries列出胶囊内部条目，read按行读取指定正文。命令输出JSON，正文响应保留读取范围和续读位置。

## 创建与写入

```sh
node src/cli.mjs create 工具 --description 工具入口
node src/cli.mjs mount 工具 /工具
node src/cli.mjs create 求和工具 --engine node --entry main.mjs
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

第一版提供CLI、独立胶囊缓存和Node内置模块脚本运行。带第三方依赖的工具需要环境准备能力，当前会给出诊断。图形界面、Python运行环境和依赖安装将在同一客户端服务上继续扩展。

异常终止留下的缓存锁会明确给出位置。先停止使用同一缓存的客户端进程，核对原持有者已退出，再移除该锁文件重试。脏缓存中的修改需要先保留并核对。
