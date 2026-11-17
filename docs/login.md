# 连接、登录与 Agent 操作

人和Agent都用用户名、密码登录同一账户，通过同一个/api/access/login取得登录会话。前端与CLI复用身份、权限和保存接口，同一配置默认共享会话。员工不需要修改环境文件，客户端不保存密码。

## 首次连接

安装依赖后运行`npm run ui`；Windows PowerShell使用`npm.cmd run ui`。打开终端输出的回环地址，首次进入显示连接与登录界面。填写知识库服务器根地址、用户名和密码；Office地址在“Office连接设置”中填写。公司服务器参照[腾讯云地址](tencent-connection.md)，不要省略端口或使用ERP根入口。

登录后进入知识库。cube菜单的“连接与登录”可查看身份、换服务器、换账户、修改密码或退出；“账户与管理”提供管理员工、凭据、cap权限、审计及备份功能，不增加常驻账户栏。

远程密码操作要求HTTPS，本机开发允许回环HTTP。错误密码、停用账户或未配置密码时不会覆盖当前有效连接；网络失败保留资料和诊断，不据此自动注销或重新提交。

人或Agent使用CLI连接、登录：

```sh
node src/cli.mjs connection https://150.158.44.59:12090 --office-url https://150.158.44.59:12091
node src/cli.mjs login 你的用户名
node src/cli.mjs me
node src/cli.mjs whoami
node src/cli.mjs ls /
```

login隐藏交互输入密码；未提供用户名时也会询问。Agent在非交互环境使用`--password-file UTF-8文件`或`--password-file -`从标准输入读取同一账户密码，不另行签发长期令牌。命令不接受明文密码argv；密码文件放在本人私有目录，不写共享脚本、命令历史、cap或Git。connection不带地址显示当前地址和配置位置，不返回令牌。

同一配置的工作台正在运行时，CLI连接、登录、退出和改密优先调用该本机桥接，协调Skill生命周期及身份切换；未发现匹配桥接时才独立操作。POST发送后的超时或未知响应不会回退并重放；先用connection与me核对实际状态。不同CAPSULE_CONFIG_HOME的工作台相互独立。

## 账户与会话

用户UUID是稳定身份；username是可修改且规范化后全库唯一的登录名，name是显示名称。管理员可修改两者、重设密码或停用员工，修改携读取时的用户revision。用户名按NFKC及小写规范化，允许2至64字符的Unicode字母、数字及._@-，以字母或数字开头。

密码为12至256字符，不得全为空白或含NUL/换行。服务端保存带随机盐的scrypt哈希，不返回密码或哈希。登录生成12小时有效、可撤销的session，过期后需重新登录；服务端每次请求及实际提交前检查会话、员工状态和权限。当前没有自动刷新、企业SSO、MFA或邮件找回，忘记密码由管理员重设。

可在连接页修改本人密码，也可执行：

```sh
node src/cli.mjs password-change
node src/cli.mjs logout
```

改密撤销该账户的全部登录会话，人和Agent都需重新登录；管理员重设密码同样生效。退出撤销当前会话，同一配置的前端和CLI随之退出；其他独立配置的会话不会因本次退出一起撤销。更改用户名不改变UUID、既有cap授权或审计，后续登录使用新用户名。

## 本机保存与隔离

ConnectionStore在当前用户私有目录保存connection.sqlite，记录服务器和Office地址、本机桥接地址及登录会话令牌，不保存密码。人和Agent在同一操作系统用户、同一配置下默认读取同一会话，具有同样的账户权限和12小时有效期。

| 系统 | 默认连接目录 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Capsule`；缺少LOCALAPPDATA时使用用户目录的AppData\Local\Capsule |
| macOS | `~/Library/Application Support/Capsule` |
| Linux | `$XDG_CONFIG_HOME/capsule`；未设置时为`~/.config/capsule` |

显式CAPSULE_CONFIG_HOME优先指定连接目录；未设置它时，显式CAPSULE_CLIENT_HOME也隔离连接。相对值按启动目录解析，跨入口使用同一个绝对路径。连接目录与缓存目录各有职责：paths显示缓存/运行位置，connection显示连接数据库位置；Windows默认同根，macOS/Linux缓存仍默认位于安装目录.local。不会自动搬迁或删除旧缓存。

会话令牌依赖操作系统文件权限保护，不宣称已经加密或接入系统钥匙串。macOS/Linux配置文件设置0600，Windows须位于当前员工的NTFS私有目录并核对ACL。不要共享活动配置、复制connection.sqlite给同事、提交Git，或放进cap、网络共享和跨电脑同步目录。每名员工应在自己的系统账户下登录。

## 草稿与账户切换

存在未保存正文、表格、属性或Office修改时，界面拒绝切换服务器、其他账户、退出或改密，先保存或处理草稿。同一服务器、同一用户在会话过期后重新登录可保留草稿；客户端同时核对稳定用户ID，不因用户名被重新使用而误认原账户。

CLI或另一进程从外部切换同一配置后，旧页面会隐藏原账户内容并要求核对身份；原草稿不转交给新用户。需要处理旧草稿时，用旧账户重新登录，再保存或导出。网络错误不当作身份变更，不自动丢弃草稿。连接切换会停止本机客户端管理的Skill页面并重建会话，不借用旧账户继续访问。

## Agent与权限

Agent执行CLI login，或直接使用同一配置中已经登录的会话，随后用me/whoami核对实际账户。没有单独的Agent角色或额外权限；同一会话的审计主体及credentialId相同，不宣称区分每一步是人还是Agent执行。需要隔离时使用不同账户或不同CAPSULE_CONFIG_HOME，并按相同用户名密码流程登录。

既有长期Bearer接口及CAPSULE_TOKEN环境配置保留用于兼容旧脚本和维护，不作为新的Agent接入流程。显式CAPSULE_TOKEN仍优先于CLI保存的会话，旧脚本改用登录会话前须核对并移除遗留环境值；图形工作台忽略该兼容令牌。长期凭据仍可单独撤销，且不会由普通退出或改密自动撤销。部署管理员bootstrap属于独立维护恢复入口，不作为员工或Agent的日常账户。

账户仅分管理员admin和普通员工editor。管理员拥有全部权限；每个cap统一设置所有非管理员的权限：edit可读取和编辑，read只读且允许复制为新cap编辑，none不可访问。新建或复制的cap默认edit，不继承源cap的权限、个人授权或版本历史。普通员工不能更改cap权限，不再设置逐员工例外。服务端将旧viewer迁为editor并保留用户UUID；实际cap权限仍以统一设置为准。

权限适用于该cap全部挂载，不继承虚拟父节点，也不随内容回撤改变；同名重建是新的普通cap。管理员在“账户与管理→胶囊权限”使用三档下拉设置，CLI使用相同接口：

```sh
node src/cli.mjs cap-access 产品说明.md
node src/cli.mjs cap-access 产品说明.md --revision 当前权限修订 --permission read
node src/cli.mjs copy 产品说明.md 我的副本.md --token 源cap的token
node src/cli.mjs mount 我的副本.md /我的副本.md
```

cap-access不传修改字段时只读查询；权限revision来自该查询，不能用正文token代替。grants保留只读别名，cap-protect的true/false兼容映射none/edit；个人grant-set明确停用。复制不获取源编辑锁、不改变源内容，CLI成功后另行挂载；若复制结果未知，先查目标名称和原eventId，不自动重放。具体规则由[服务端身份说明](../../capsule-server/docs/access.md)维护。

登录会话、兼容长期凭据、正文版本token、位置token和编辑租约proof不能互换。登录不绕过版本保护或占用检查；启动Skill时从子进程环境移除客户端指定认证变量，不构成安全沙箱。
