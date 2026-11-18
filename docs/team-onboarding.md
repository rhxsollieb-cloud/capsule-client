# 同事接入胶囊知识库

推荐用 GitHub CLI 安装和更新[胶囊客户端](https://github.com/rhxsollieb-cloud/capsule-client)。首次克隆公开仓库的默认 `main` 分支，以后在同一目录更新。知识库连接地址与个人账户由管理员单独发放。

## 推荐安装 GitHub CLI 版

先安装 [Node.js 24 LTS](https://nodejs.org/en/download/)、[GitHub CLI](https://cli.github.com/) 和 Git。Windows 选 [Git for Windows](https://gitforwindows.org/)，安装后重新打开 PowerShell。本机工作台和 CLI 使用原生 Node.js，无需 WSL、Docker 或服务端源码。使用远程 ONLYOFFICE 时，也无需安装 Microsoft Office。

在本人可写的本机目录打开 PowerShell，确认工具可用并安装客户端：

```powershell
node --version
git --version
gh --version
gh repo clone rhxsollieb-cloud/capsule-client
Set-Location -LiteralPath '.\capsule-client'
npm.cmd ci
npm.cmd run ui
```

若 `gh` 提示登录，用自己的 GitHub 账号执行 `gh auth login` 再克隆。仓库公开，无需申请读取权限。GitHub 账号用于获取客户端，工作台登录使用管理员发放的账户。`npm.cmd` 使用 Node 附带的 Windows 入口，保持现有 PowerShell 执行策略。首次安装依赖需要能访问 npm registry。

macOS 和 Linux 使用相同的克隆命令，然后执行 `cd capsule-client`、`npm ci` 和 `npm run ui`。

## 更新 GitHub CLI 版

先保存并停止旧工作台，在原来的克隆目录确认当前分支为 `main`。

```powershell
git status --short --branch
gh repo sync --source rhxsollieb-cloud/capsule-client --branch main
npm.cmd ci
npm.cmd run ui
```

macOS 和 Linux 将 `npm.cmd` 换成 `npm`。更新只做快进，先保留自己的源码修改，遇到分支分叉时按提示核对。在追踪 `origin/main` 的本地 `main` 上，`git pull --ff-only` 也是更新方式。以前克隆了开发分支的同事先运行 `git fetch origin`，再用 `git switch main` 切换。若尚无本地 `main`，用 `git switch --track origin/main` 创建追踪分支。

## 备选安装 ZIP

没有安装 GitHub CLI 或需要离线传递源码包时，可从[最新发行版](https://github.com/rhxsollieb-cloud/capsule-client/releases/latest)的 Assets 下载 `capsule-client-提交号.zip` 和同页的 `SHA256SUMS`。浏览器下载无需 GitHub 账号。ZIP 仍需要 Node.js、Git 及 npm 依赖安装。

在下载目录打开 PowerShell，把以下「提交号」换成文件名里的实际值，核对 ZIP 的 SHA-256：

```powershell
Get-FileHash -LiteralPath '.\capsule-client-提交号.zip' -Algorithm SHA256
Get-Content -LiteralPath '.\SHA256SUMS'
```

校验一致后解压并启动：

```powershell
Expand-Archive -LiteralPath '.\capsule-client-提交号.zip' -DestinationPath '.\Capsule-提交号'
Set-Location -LiteralPath '.\Capsule-提交号\capsule-client'
npm.cmd ci
npm.cmd run ui
```

macOS 和 Linux 核对 SHA-256 后解压，进入 `capsule-client` 执行 `npm ci` 和 `npm run ui`。ZIP 不含 Git 历史，升级时先停止旧工作台，再把新包解压到新目录并重新安装依赖。

## 登录

打开启动终端显示的本机地址，默认为 `http://127.0.0.1:5183`。在「连接与登录」中填入管理员提供的知识库服务器地址、用户名及密码，再展开「Office 连接设置」填入管理员提供的 Office 服务地址。首次连接时请核对两个地址，保留 HTTPS、主机名及端口。

首次登录后可在「连接与登录」中修改本人密码，再重新登录。客户端保存连接和有期限的会话。界面与 CLI 可在同一系统用户下使用同一个本机配置。登录和会话变更见[连接与登录说明](login.md)。

## 使用与保留本机配置

- **访问权限**：读写可编辑与保存。只读可阅读、下载或复制为新的可编辑 cap。无访问的 cap 不出现在列表中。管理员为每个 cap 设置普通员工统一的访问档位。
- **编辑**：进入编辑前先取得占用。遇到占用或版本冲突先核对现有内容。保存 Office 文件后，等知识库确认提交。关闭前保存，在启动终端按 Ctrl+C 停止客户端。
- **Windows 配置**：两种安装方式默认继续使用当前用户在 `%LOCALAPPDATA%\Capsule` 中的配置和缓存。已有自定义路径时沿用原配置，见[Windows 使用说明](windows.md#本机路径与配置)。
- **CLI**：在客户端目录运行 `node src/cli.mjs me` 核对身份，再用 `node src/cli.mjs guide cli` 查看日常和批量用法。切换安装目录后可从新目录重新链接 `capsule.cmd`。

macOS 和 Linux 的缓存默认位于安装目录的 `.local`。在原克隆目录更新可沿用该目录。通过 ZIP 换目录前，用 `node src/cli.mjs paths` 和 `node src/cli.mjs connection` 核对本机路径。需要沿用原运行目录时，可用 `CAPSULE_CLIENT_HOME` 和 `CAPSULE_CONFIG_HOME` 分别指定原来的绝对路径。见[本机保存与隔离](login.md#本机保存与隔离)。

## 常见问题

- **Node、Git 或 gh 未找到**：核对安装和 PATH，重新打开 PowerShell，再运行版本检查。也可按上面的备选步骤使用 ZIP。
- **端口已占用**：先确认旧客户端已停止。需要同时使用另一个本机端口时，按[远程连接说明](tencent-connection.md)指定独立端口。
- **HTTPS 或权限报错**：核对管理员提供的完整地址和本机系统时间，保留错误信息交给管理员。保留证书验证。
- **无法保存**：先查看占用、权限与版本提示。以知识库保存回执判断是否已提交。
