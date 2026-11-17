# 连接腾讯云服务端

客户端工作台与Agent继续在员工本机运行，知识内容保存到远程服务端。人和Agent用相同用户名密码登录，默认共用本机配置和会话，不需要编辑环境文件。本机桥接不开放到公网，Agent通过同一客户端CLI同步版本并在本机执行Skill。

| 入口 | 地址与用途 |
| --- | --- |
| 原有ERP | IP根地址的HTTP/80与HTTPS/443，保留现有服务 |
| 胶囊API | https://150.158.44.59:12090，填入知识库服务器 |
| ONLYOFFICE Docs | https://150.158.44.59:12091，填入Office连接设置 |
| 本机工作台 | 启动终端显示的回环地址；默认http://127.0.0.1:5183，可独立使用5185 |

IP根地址属于ERP，胶囊必须保留12090和12091端口，不使用不带端口的根地址，不占用ERP的80/443入口。API端口不是图形工作台入口。HTTPS由共享网关管理IP证书和自动续签，保留正常TLS校验；服务部署见[腾讯云部署说明](../../capsule-server/docs/tencent-deployment.md)。

## 员工连接

在客户端项目安装、启动：

```sh
npm ci
npm run ui
```

Windows PowerShell使用npm.cmd ci与npm.cmd run ui。打开终端输出的本机URL，填写上表API和Office地址，输入管理员分配的用户名密码。已进入工作台后，从知识库cube菜单打开“连接与登录”更改连接或账户。登录、草稿切换、会话保存和隐私边界见[登录说明](login.md)。

默认本机端口为5183。需要独立5185端口时先运行npm run build:web，再选择以下启动方式；Windows构建命令为npm.cmd run build:web。

```sh
CAPSULE_UI_PORT=5185 node src/ui/main.mjs
```

Windows PowerShell对应写法：

```powershell
$env:CAPSULE_UI_PORT = '5185'
node src/ui/main.mjs
```

选择本机端口不要求编辑连接数据库；CLI读取同一配置时采用工作台保存的本机地址。

CLI也可独立连接和登录：

```sh
node src/cli.mjs connection https://150.158.44.59:12090 --office-url https://150.158.44.59:12091
node src/cli.mjs login 你的用户名
node src/cli.mjs me
node src/cli.mjs ls /
```

人可在终端隐藏输入密码；Agent非交互使用login的--password-file文件或-，也可读取同一配置已有会话。会话同样12小时到期，me核对当前账户及角色；不要把密码写进明文参数或历史。connection不带参数显示地址和配置位置。服务端保存仍核对cap版本、权限和编辑租约。关闭前保存编辑内容，在启动终端按Ctrl+C等待收尾；关闭浏览器标签页不会停止本机工作台或Skill。

## 旧脚本与维护配置

日常人和Agent都使用用户名密码登录。已有.local/tencent.env或.local/ui.env仅为兼容旧脚本和维护保留，不自动迁移其中令牌，也不覆盖已有缓存；不分发部署管理员.env或Office JWT密钥。

既有长期凭据API与CAPSULE_TOKEN仍兼容；显式环境值优先于CLI保存的会话，采用统一登录前应核对是否留有旧令牌。旧配置须放在受保护的本机目录，不提交Git、不放cap或聊天，不复制维护者路径或令牌给员工。兼容凭据撤销和部署恢复通道见[服务端身份管理](../../capsule-server/docs/access.md)。

多个工作台、不同服务器或测试账户需独立配置时，用CAPSULE_CONFIG_HOME指定各自的私有连接目录；需要同时隔离缓存和运行资料时也指定CAPSULE_CLIENT_HOME。Windows路径、NTFS及PowerShell用法见[Windows使用说明](windows.md)。
