# 连接腾讯云服务端

客户端工作台和Agent继续在员工本机运行，知识内容保存到远程服务端。本机桥接不开放到公网；Agent通过同一客户端CLI同步版本并在本机执行Skill。

| 入口 | 地址与用途 |
| --- | --- |
| 原有ERP | IP根地址的HTTP/80与HTTPS/443，保持现有服务 |
| 胶囊API | https://150.158.44.59:12090，使用员工个人凭据访问 |
| ONLYOFFICE Docs | https://150.158.44.59:12091，供浏览器加载Office编辑器 |
| 本机工作台 | http://127.0.0.1:5185，浏览器与本机Skill稳定通道 |

IP根地址属于ERP，胶囊配置必须保留12090和12091端口，不使用不带端口的根地址，也不占用或改动ERP的80/443入口。胶囊服务器端口不是图形工作台入口。HTTPS由共享Caddy管理短期IP证书和自动续签，连接时保留正常TLS校验。服务部署、发布目录和维护方式见[腾讯云部署说明](../../capsule-server/docs/tencent-deployment.md)。

## 本机连接文件

使用独立的`.local/tencent.env`，文件权限为0600。以下为配置示例，`PERSONAL_TOKEN_PLACEHOLDER`必须由该员工自己的个人凭据替换：

```dotenv
CAPSULE_SERVER_URL=https://150.158.44.59:12090
CAPSULE_ONLYOFFICE_URL=https://150.158.44.59:12091
CAPSULE_UI_PORT=5185
CAPSULE_CLIENT_URL=http://127.0.0.1:5185
CAPSULE_CLIENT_HOME=/Users/apexwave/Desktop/capsule-client/.local/tencent
CAPSULE_TOKEN=PERSONAL_TOKEN_PLACEHOLDER
```

其他电脑将CAPSULE_CLIENT_HOME改为自己的绝对路径。该连接文件仅留本机，不提交Git、不放入cap或聊天；部署管理员bootstrap凭据与Office JWT密钥由服务端维护，不分发给员工。个人凭据的签发、撤销和授权见[身份管理说明](../../capsule-server/docs/access.md)。

腾讯云连接使用独立缓存及运行目录，保留原`.local/ui.env`、旧本机知识库和已运行的5183工作台；切换时先保存当前内容，不复用旧连接的未提交草稿。

## 启动与CLI

在capsule-client项目目录构建并启动本机工作台：

```sh
npm run build:web
node --env-file=.local/tencent.env src/ui/main.mjs
```

随后在浏览器打开http://127.0.0.1:5185。CLI读取同一份连接配置：

```sh
node --env-file=.local/tencent.env src/cli.mjs health
node --env-file=.local/tencent.env src/cli.mjs me
node --env-file=.local/tencent.env src/cli.mjs help leases --json
node --env-file=.local/tencent.env src/cli.mjs ls /
```

先用me核对实际员工身份，再进行内容修改。远端保存仍核对cap版本、授权和编辑租约；本机缓存、独立运行副本与Skill state按客户端生命周期管理。停止5185工作台可在启动终端使用Ctrl+C，之后用同一启动命令恢复。
