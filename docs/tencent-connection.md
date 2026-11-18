# 连接远程知识库

客户端工作台和 CLI 在本机运行。由管理员单独提供知识库服务器地址、Office 服务地址和个人登录账户。按[同事接入说明](team-onboarding.md)用 GitHub CLI 安装和更新，或使用[最新发行 ZIP](https://github.com/rhxsollieb-cloud/capsule-client/releases/latest)。

| 项目 | 填写方式 |
| --- | --- |
| 知识库服务器 | 管理员给出的知识库服务根地址，保留 HTTPS 和端口 |
| Office 连接设置 | 管理员给出的 ONLYOFFICE Docs 根地址 |
| 本机工作台 | 启动终端输出的回环地址，默认为 `http://127.0.0.1:5183` |

打开本机工作台，在「连接与登录」输入上述地址及个人账户。工作台已打开时，从知识库图标菜单进入该页面。详细连接、登录及草稿处理见[登录说明](login.md)。

## 设置本机端口

默认端口已被占用或需启动独立工作台时，可用环境变量指定空闲回环端口。命令在已安装依赖的客户端目录执行。

Windows PowerShell：

```powershell
$env:CAPSULE_UI_PORT = '5185'
npm.cmd run ui
```

macOS 和 Linux：

```sh
CAPSULE_UI_PORT=5185 npm run ui
```

打开终端实际输出的本机地址。连接资料与缓存分别可由 `node src/cli.mjs connection` 和 `node src/cli.mjs paths` 核对。多个工作台需要独立连接时，用 CAPSULE_CONFIG_HOME 指定各自私有配置目录；需要同时隔离缓存和运行资料时指定 CAPSULE_CLIENT_HOME。

## CLI 连接

CLI 和工作台默认共用同一份本机登录。首次通过 CLI 登录的写法如下，将示例域名及用户名替换为管理员发放的实际值。

```sh
node src/cli.mjs connection https://knowledge.example.com --office-url https://office.example.com
node src/cli.mjs login 你的用户名
node src/cli.mjs me
node src/cli.mjs ls /
```

`login` 隐藏交互输入的密码。登录会话默认 12 小时有效。显式 CAPSULE_TOKEN 供旧脚本兼容，仍优先于 CLI 保存的会话。关闭前保存，在启动终端按 Ctrl+C 等待工作台收尾。
