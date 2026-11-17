# 同事接入胶囊知识库

本文是可进入仓库的安装说明。六个花名及初始密码见管理员单独交付的员工接入文档；不把密码、活动登录配置或管理员密钥放进客户端源码与安装包。

## 安装前准备

每台电脑安装 [Node.js 24 或以上](https://nodejs.org/en/download/) 和 [Git](https://git-scm.com/downloads)。推荐另装 [GitHub CLI](https://cli.github.com/) 取得及更新源码。Windows 使用原生 PowerShell，不需要 WSL、Docker、Microsoft Office 或服务端源码；安装工具后重新打开终端。

```sh
node --version
git --version
```

客户端仓库：[rhxsollieb-cloud/capsule-client](https://github.com/rhxsollieb-cloud/capsule-client)。仓库为私有，GitHub 登录需有该仓库读取权限；知识库花名账户不等于 GitHub 账户。当前可用代码在 `codex/initial-development` 分支，首次克隆明确选此分支。

## 推荐：GitHub CLI

```sh
gh auth login
gh repo clone rhxsollieb-cloud/capsule-client -- --branch codex/initial-development
cd capsule-client
npm ci
npm run ui
```

Windows 将最后两条写为 `npm.cmd ci`、`npm.cmd run ui`，不必修改 PowerShell 执行策略。`gh auth login` 使用自己的 GitHub 登录，不复制其他人的 GitHub token。克隆命令与更新方式参照 [GitHub CLI 官方说明](https://cli.github.com/manual/gh_repo_clone)。

后续升级先保存并停止客户端，再在这个目录执行：

```sh
git pull --ff-only origin codex/initial-development
npm ci
npm run ui
```

Windows 同样用 npm.cmd。若有自己修改的源码，先保留并核对，不强制覆盖或执行 reset。

## 没有 GitHub CLI：解压安装

从管理员交付包取得 `capsule-client-提交号.zip` 和 `SHA256SUMS`，核对校验值，解压到本人可写的本机目录。ZIP 是精确 Git 提交的源码归档，不含 node_modules、工作区、员工密码或登录配置。没有 GitHub 账号也可使用管理员交付的 ZIP；运行客户端仍需要安装 Git。

Windows PowerShell：

```powershell
Get-FileHash '.\capsule-client-提交号.zip' -Algorithm SHA256
Expand-Archive -LiteralPath '.\capsule-client-提交号.zip' -DestinationPath '.\Capsule'
Set-Location '.\Capsule\capsule-client'
npm.cmd ci
npm.cmd run ui
```

macOS/Linux：

```sh
shasum -a 256 capsule-client-提交号.zip
unzip capsule-client-提交号.zip -d Capsule
cd Capsule/capsule-client
npm ci
npm run ui
```

替换示例中的提交号和路径。也可登录仓库后使用 Code → Download ZIP，但须确认下载的是上述分支；[GitHub 源码归档说明](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)。ZIP 没有 .git，不能 git pull；更新时停止旧客户端，将新版解压到新目录并重新 npm ci，不把旧 node_modules 复制进去。macOS/Linux 更新安装目录时，按 connection/paths 核对并继续使用原缓存位置，具体见[登录说明](login.md#本机保存与隔离)。

## 连接并认领花名

打开启动终端显示的本机地址，默认 `http://127.0.0.1:5183`，在“连接与登录”填写：

| 项目 | 填写值 |
| --- | --- |
| 知识库服务器 | https://150.158.44.59:12090 |
| Office 服务（展开 Office 连接设置） | https://150.158.44.59:12091 |
| 用户名 | 从员工接入文档的六个花名中认领一个 |
| 密码 | 该花名对应的初始密码 |

不要省略端口：根 IP 的 80/443 是 ERP 入口。日常登录只需要花名和密码，没有另一个共享接入密钥；Office JWT、部署管理令牌和 GitHub token 不属于员工连接参数。客户端保存连接与有期限的登录会话，不保存密码，无需编辑 .env。

先在团队约定的地方登记认领结果，避免两人同时使用一个花名。首次登录后，从知识库图标菜单进入“连接与登录”，修改本人密码，再重新登录。用户名需要更改时由管理员修改，保留同一用户身份。每人使用自己的电脑账户，不向他人复制 connection.sqlite。密码修改会使同一花名的人和 Agent 会话都需重新登录。

## 权限与编辑

管理员针对每个 cap 统一设置所有非管理员的访问档位，不逐员工授权：

| 档位 | 可做的操作 |
| --- | --- |
| 读写 | 阅读、下载、复制；普通员工还可占用并编辑、保存和回撤 |
| 只读 | 阅读、下载、复制；不能修改源 cap，可复制为新 cap 后编辑 |
| 无访问 | 不显示、不读取、不下载、不复制 |

管理员始终可管理；花名账户均为普通员工（代码角色 editor），新建普通 cap 默认读写。源 cap 只读时，在节点或文件菜单选择“复制为新 cap”，填写全库唯一名称。副本有独立数据和新版本历史，不改源 cap；副本默认读写。已有下载或副本不会因源权限后来变化自动收回。账户只分管理员和普通员工，三档访问设置属于 cap，不属于个人。

编辑前点击“占用并编辑”，看到同事占用时等待释放。明确保存才提交版本；关闭编辑或切换会释放占用，当前页面存活期间保留未保存草稿。保存冲突先核对，不反复点击保存或复制。Office 等待知识库提交确认，不能把“输入已收集”视为保存完成。退出前保存，在启动终端按 Ctrl+C 结束客户端。

## Agent 使用同一登录

人已在本机工作台登录时，Agent 直接使用同一客户端 CLI：

```sh
node src/cli.mjs me
node src/cli.mjs ls /
node src/cli.mjs help
```

尚未登录时可执行 connection 和 login；login 在终端隐藏输入密码。Agent 非交互使用 --password-file 的私有文件或标准输入，不把密码写进参数、脚本、cap 或命令历史。会话默认12小时；到期重新登录，不额外申请 Agent 密钥。[完整登录与 Agent 说明](login.md)

## 常见问题

- Node 版本过低：升级到24或以上，再执行 npm ci；前端服务需保持终端运行。
- 5183 被占用：不要结束其他人的 Node 进程；按[连接说明](tencent-connection.md)选择另一回环端口。
- HTTPS、权限或网络报错：核对完整地址和系统时间，保留错误信息交给管理员，不关闭证书校验。
- 仓库无法克隆：确认自己的 GitHub 账户有仓库读取权限，或使用管理员交付的 ZIP；这不影响花名账户登录知识库。
- 无法保存：先查看占用、权限与版本提示；草稿保留不代表已经备份到服务端。

维护者生成安装包：先完成检查并提交，然后 `npm run package:client -- 输出目录`。脚本只归档当前 Git 提交并生成 SHA256SUMS 和 release.json，拒绝脏源码和覆盖已有包。
