# Windows 客户端

先安装 Windows [Node.js 24 LTS](https://nodejs.org/en/download/)、[Git for Windows](https://gitforwindows.org/) 和 [GitHub CLI](https://cli.github.com/)，安装后重新打开 PowerShell。CLI、本机工作台、缓存及 Skill 使用同一套客户端模块。连接已部署的服务端和 ONLYOFFICE 时，本机无需 WSL、Docker、Microsoft Office 或数据库服务。

## 安装

在本人可写的目录中用 GitHub CLI 克隆公开仓库。若 `gh` 提示登录，使用自己的 GitHub 账号执行 `gh auth login`。

```powershell
node --version
git --version
gh --version
gh repo clone rhxsollieb-cloud/capsule-client
Set-Location -LiteralPath '.\capsule-client'
npm.cmd ci
node src/cli.mjs help
```

安装 Node 和 Git 后重新打开终端，使 PATH 生效。`node --version`须至少为 v24；`git --version`须能正常返回。`npm.cmd`直接使用随 Node 安装的命令入口，不需要修改 PowerShell 执行策略。跨系统复制源码后重新执行 npm.cmd ci，不复制其他电脑的 node_modules 或 web/vendor。

运行 `npm.cmd run ui`，打开终端输出的回环地址，在连接页填写管理员单独提供的 API、Office 地址和个人账户。CLI 使用同一份保存的连接。地址填写和切换账户见[登录说明](login.md)。

升级前先保存并关闭旧工作台。在原克隆目录的本地 `main` 分支执行 `gh repo sync --source rhxsollieb-cloud/capsule-client --branch main`，然后运行 `npm.cmd ci` 和 `npm.cmd run ui`。遇到冲突先保留并核对本地修改。

不使用 GitHub CLI 时，可按[同事接入说明](team-onboarding.md#备选安装-zip)校验并解压[最新发行 ZIP](https://github.com/rhxsollieb-cloud/capsule-client/releases/latest)。默认配置和缓存继续保存在当前系统用户的应用目录。已有自定义路径时沿用原设置，换安装目录后可从新目录重新运行 `npm.cmd link`。

## 本机路径与配置

ConnectionStore默认把connection.sqlite保存在当前用户的`%LOCALAPPDATA%\Capsule`，缺少LOCALAPPDATA时使用用户目录下的AppData\Local\Capsule。它保存连接和有期限的登录会话，不保存密码。CLI connection显示配置位置，paths显示缓存/运行位置。

CAPSULE_CLIENT_HOME保存客户端SQLite、缓存、Skill工作目录和运行记录，Windows默认也是上述目录。需要隔离测试或多套连接时，CAPSULE_CONFIG_HOME优先指定连接目录；未设置它时，显式CAPSULE_CLIENT_HOME也隔离连接。普通员工不需要设置这些环境变量。维护者可在PowerShell显式指定自己的私有目录，例如：

```powershell
$env:CAPSULE_CONFIG_HOME = 'C:\Users\你的用户名\AppData\Local\Capsule\测试连接'
$env:CAPSULE_CLIENT_HOME = 'C:\Users\你的用户名\AppData\Local\Capsule\测试缓存'
```

路径使用本人的完整盘符路径，含空格或中文时保留引号。PowerShell临时设置本机端口可用`$env:CAPSULE_UI_PORT = '5185'`，不要使用POSIX的`变量=值 命令`写法。旧脚本或维护者仍使用dotenv时，文件内不会展开`$env:LOCALAPPDATA`、`%LOCALAPPDATA%`或`~`，应填入实际路径。

缓存使用本机 NTFS 磁盘，跨进程发布锁需要硬链接；CLI 的 --out 原子发布同样需要目标目录支持硬链接。不使用网络共享、exFAT 或跨电脑同步文件夹承载活动缓存。已有 Windows 旧版本使用安装目录 .local 的，升级前将 CAPSULE_CLIENT_HOME 显式设为原绝对路径即可继续使用；客户端不会自动搬迁旧目录。其他系统默认路径保持原样。

cap 名称与虚拟路径是服务端的数据身份，entry 始终使用 `/`分隔；本机上传、下载和 --out 路径才使用 Windows 文件路径。不要把 C:\ 路径当成 cap 的 entry，也不要把虚拟路径改成反斜杠。capsule 的实际缓存目录使用身份哈希，不按虚拟路径创建目录。

远端资料可以按统一接口浏览；Git 同步和本机 Skill 运行会在落盘前核对 Windows 文件名及大小写冲突。远端存在 Windows 无法准确表示的名称时，保留远端原数据并给出诊断，不通过重命名或覆盖相邻文件来完成 checkout。

connection.sqlite含会话令牌，须放在当前员工的NTFS私有目录，不提交Git、不放cap或跨电脑同步目录。Windows使用NTFS ACL控制读取，POSIX的0600不代表已配置相同权限；会话数据库不是加密钥匙串。每名员工使用自己的Windows账户及应用目录。人和Agent默认共享同一配置的登录会话，密码不写明文命令参数或历史。

## 启动与停止

在项目目录启动工作台，自动构建网页：

```powershell
npm.cmd run ui
```

打开终端输出的地址，默认为 `http://127.0.0.1:5183`。连接页选择服务器并登录，工作台只监听本机回环。需要其他本机端口时，启动前设置 CAPSULE_UI_PORT，见[远程连接说明](tencent-connection.md#设置本机端口)。

CLI在另一个使用相同配置目录的PowerShell窗口读取同一份身份：

```powershell
node src/cli.mjs me
node src/cli.mjs health
node src/cli.mjs connection
node src/cli.mjs paths
node src/cli.mjs ls /
```

包含中文的批量整理操作建议保存为 UTF-8 JSON 文件，再运行 `node src/cli.mjs organize --prepare operations.json --out plan.json`。这样能避开 Windows PowerShell 5.1 向原生命令传送文本时的默认编码差异。

CLI也可执行connection和login完成首次连接，login在终端隐藏输入密码。Agent也通过login使用同一用户名密码，非交互从--password-file文件或-读入。人和Agent默认共享会话及权限，同样12小时到期。显式CAPSULE_TOKEN仅兼容旧脚本，其CLI优先级保留，图形登录不使用该值。可选短命令：npm.cmd link后使用capsule.cmd；权限或策略不允许link时继续用node。切换账户或服务器前保存草稿，有草稿时界面会阻止不属于原用户的切换。

关闭前保存编辑内容，在启动工作台的终端按 Ctrl+C，等待进程退出。工作台会停止自己启动的 Skill 页面；仅关闭浏览器标签页不会停止本机进程。直接关控制台或由任务管理器强制结束不保证完成收尾。不要通过删除缓存锁或结束所有 node.exe 来关闭当前客户端。

## Skill 运行边界

Skill 仍以 SKILL.md、scripts/cli.mjs 和可选 scripts/ui.mjs 管理，Node 直接启动入口，参数按独立 argv 传递。Windows 路径可包含空格或中文；Skill 自行调用的外部程序也应使用独立参数和本机可执行文件路径。

客户端不隐式提供 bash、不自动执行 .cmd/.bat，也不自动安装 Skill 依赖。需要 ffmpeg、Python 或其他本机工具的 Skill 应在 SKILL.md 写明 Windows 安装及调用要求；Linux 专用脚本不会因此自动变成跨平台工具。

Skill 协作页面继续通过 fd 3 返回本机就绪地址。Windows 停止页面时由 taskkill.exe 收回本次启动的进程树，不能依赖 POSIX SIGTERM 回调完成最后一次业务保存；每次确认保存就应持久提交。未确认退出时保留占用并报告诊断，不把发送终止请求当作已经释放。详见[Skill 协议](skills.md)。

## 检查

```powershell
npm.cmd run check
npm.cmd test
```

单元测试使用隔离临时目录。需要同级 capsule-server 源码的集成测试缺少源码时明确跳过。公开 Windows CI 从同一 Git 提交打包 ZIP，解压到含中文和空格的路径后安装依赖，核对 `capsule.cmd` 的机器帮助并运行静态检查和 Node 测试。员工本机与公司服务的连接验收单独核对。
