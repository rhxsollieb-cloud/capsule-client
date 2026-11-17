# 代码 Skill 与本机协作

客户端run仅接受code类别的Skill。它沿用Agent Skills的SKILL.md说明形式，并增加胶囊客户端的版本、固定CLI和可选本机协作约定。格式、服务端校验与显式转换以[服务端API契约](../../capsule-server/docs/api.md)为准，普通files中的代码仍作为内容管理。本页可通过`capsule guide skills`离线渐进查询，数据模型见`capsule guide data`。

## 与常规Agent Skill的关系

[Agent Skills规范](https://agentskills.io/specification)要求SKILL.md，脚本是可选资源，不强制统一CLI、Git或UI。胶囊Skill在此说明形式之上增加以下宿主约定：

| 方面 | 胶囊Skill约定 |
| --- | --- |
| 身份 | 顶层cap名称全库唯一，可为中文；SKILL.md的name是小写字母/数字/连字符标识，两者分别使用 |
| 数据所有权 | 每个code cap拥有独立内容与Git，不共享其他cap文件，不另放cap.json/skill.json/登记库 |
| 可执行入口 | 必需scripts/cli.mjs，固定Node.js 24或以上启动，可调用其他语言与本机工具 |
| 协作入口 | scripts/ui.mjs可选；明确注册并启动，独立本机页面，不需要协作时不启动 |
| 版本 | 更新原cap产生新commit；客户端同步并核验精确提交，运行记录包含实际commit |
| 状态 | 代码版本与本机持久状态分开，CLI/UI通过CAPSULE_SKILL_STATE共享后者 |
| 升级 | 活跃或待核对UI与CLI不能混用不同提交；先停止，再注册新版本 |

cap名称不要求等于frontmatter的name，客户端物理工作区目录也不以该name命名。传统规范要求技能目录名与name一致；若将内容交给其他Skill宿主，应另按该name组织目录并核对其要求。当前没有自动导出/安装到其他Agent的命令，也不把普通Skill目录原样导入就宣称可运行。

两种说明字段也不同：顶层cap.description是最多180字符的全库简述；SKILL.md的description是最多1024字符、用于说明Skill何时使用的元数据。code的完整详述就是SKILL.md，不在顶层重复保存一份正文。

```text
SKILL.md            # YAML frontmatter: name、description；正文说明何时及如何使用
scripts/cli.mjs     # 必需，独立 CLI
scripts/ui.mjs      # 可选，本机协作页面的启动器
```

无需 cap.json、skill.json 或 cap 内登记库。原生工程文件、资源与依赖配置可按 Skill 的实际需要组织。当前稳定启动入口是 Node.js 24；CLI 和 UI 启动器可调用本机其他语言、框架和系统工具，不限于内置模块，客户端不自动安装依赖。

## CLI 与注册通道

不需要人机协作的 Skill 直接使用独立 CLI，不启动页面或图形进程。`run`仍先读取服务端提交、同步精确版本并创建隔离运行快照，输出与实际提交写入客户端 SQLite。

```sh
node src/cli.mjs run 工具名称 -- 参数
node src/cli.mjs skill-register 工具名称
node src/cli.mjs skill-status 工具名称
node src/cli.mjs skill-start 工具名称
node src/cli.mjs skill-stop 工具名称
```

注册、状态、启动、停止经稳定本机通道访问客户端：GET /ui/session，再携本机会话校验头POST /ui/action，对应skill-register/status/start/stop。CLI默认连接http://127.0.0.1:5183，设置CAPSULE_UI_PORT时跟随对应端口，可用CAPSULE_CLIENT_URL明确指定本机客户端根地址；无需把服务端Bearer交给Skill。该通道由正在运行的本地图形服务提供，headless的run不依赖图形服务。

人和Agent通过相同用户名密码登录，Agent用CLI login或读取同一配置已有会话；非交互从--password-file文件或-读入密码，不传明文密码argv。前端和Agent CLI默认共享12小时会话及账户权限，run的远端查询和审计使用该身份。身份切换会停止工作台管理的Skill页面；连接、会话保存与草稿规则见[登录说明](login.md)。Skill可读及可运行范围仍由对应身份权限判断，cap统一按非管理员read/edit/none判断，源可读即可下载或复制，none不可读取；权限不是按员工单独设置。

注册只同步、验证并登记，不执行UI。登记位于顶层client.sqlite；每个服务端/cap有独立本机目录，版本snapshot、可安装依赖的work副本和持久state分别管理。同提交并发准备由版本发布锁保护，复用已发布工作区；跨版本不会覆盖旧work中的本机修改。物理布局和缓存失败处理见[客户端架构](architecture.md#同步与运行)。

查询分三层：`guide skills`离线解释宿主约定，`details 名称`从服务端按行读取该Skill的SKILL.md，`skill-status 名称`经本机客户端查询登记提交、CLI路径与UI状态，并请求服务端当前概要判断升级。远端失败时status保留本机结果及serverError，已登记Skill的updateAvailable为null，不能据此确认最新。`help run --json`查询宿主命令参数；`run 名称 -- --help`会实际执行该Skill的CLI。

run每次从精确提交创建独立运行work，不复用注册UI工作区中安装的依赖。依赖与本机工具按SKILL.md准备，客户端不自动安装。status对已登记Skill返回cli.command、entry、cwd、state；直接调用该路径时，需要使用对应cwd、显式设置CAPSULE_SKILL_STATE并自行核对环境与代码。这种调用绕过客户端的远端版本检查、工作区校验、环境过滤和运行日志链；需要这些检查时使用run。

## 本机页面协议

可选scripts/ui.mjs只有明确启动时才执行，前端自托管在独立回环端口，框架、页面路由和其本机API由Skill自己维护。客户端不为Skill生成固定表单，也不把知识库HTTP入口复制进页面。

启动器收到CAPSULE_SKILL_STATE、CAPSULE_SKILL_NAME、CAPSULE_SKILL_COMMIT及CAPSULE_SKILL_READY_FD。开始监听后向该文件描述符写一行JSON：

```js
import { writeSync } from 'node:fs';
writeSync(Number(process.env.CAPSULE_SKILL_READY_FD), JSON.stringify({ url: 'http://127.0.0.1:实际端口/' }) + '\n');
```

URL必须使用127.0.0.1或localhost、HTTP和明确端口，不能含用户名密码。就绪回执独立于stdout/stderr；15秒内没有回执、返回远端地址、页面不可访问或进程提前退出会停止本次启动并给出诊断。启动登记写入失败同样停止已创建的进程，保留原始错误及清理诊断。普通日志有界保留在本机登记记录。

run与UI启动器通过同一环境构造继承宿主环境，再移除CAPSULE_TOKEN、CAPSULE_LEASE_TOKEN和CAPSULE_ONLYOFFICE_JWT_SECRET；Windows 按环境变量名大小写不敏感地移除。这不是环境白名单，也不会移除其他任意密钥。run只主动设置CAPSULE_SKILL_STATE；UI启动器还设置NAME、COMMIT和READY_FD。CLI中的后三项可能缺失，也可能继承宿主旧值，不能作为当前运行身份；实际cap与commit以run回执为准。直接调用登记CLI不经过这层过滤。

同一服务端/cap的注册、启动和停止使用跨进程生命周期短锁，不同本机端口共享home也不能并发双启或覆盖lastSession；已运行页面不持续占锁。CAPSULE_SKILL_STATE为Skill自行管理的业务状态，多次CLI与协作页面并行读写须使用SQLite事务或细粒度原子协议，客户端不替任意Skill锁住整个state，详见[并发说明](../../capsule-server/docs/concurrency.md)。

中央区域只在需要协作且页面已启动时嵌入其本机URL。启动与关闭显式操作；切换知识节点只卸载浏览器frame，不终止后台Skill。正常关闭客户端会关闭自己启动的UI进程树：POSIX 使用进程组的 SIGTERM/SIGKILL，Windows 使用系统 taskkill.exe /T /F。Windows 不提供等价的 SIGTERM 清理回调，Skill 应在每次确认保存时持久提交，不把业务保存仅放在退出处理器中。Skill页面拥有独立来源与自身前端策略，主工作台只额外允许回环HTTP frame，Office脚本来源与工作台自身脚本限制不变。

固定入口均通过当前 Node 可执行文件直接启动，Windows 无需 bash，fd 3 的就绪协议不变。客户端不把 .cmd/.bat 当作可直接执行的程序，也不自动拼接 shell 命令；Skill 需要其他本机工具时应声明平台依赖并自行采用安全的独立参数调用。PowerShell、路径与安装说明见[Windows 使用说明](windows.md)。

图形工作台的Skill操作收在已有内容标题菜单：注册、启动/关闭、运行CLI、查看SKILL.md及本机状态。不额外占用工具栏；正常状态和提交号按需查看，异常与升级提示保留。仅CLI的Skill直接呈现说明正文。

## 共享状态与升级

CLI与UI都收到同一个CAPSULE_SKILL_STATE。状态、媒体日志和运行产物放这里，不写回已同步的版本代码。Skill自行设计自己的CLI参数和本机协议；需要数据库时使用其运行区SQLite，不在cap内部再建客户端登记。Agent驱动CLI的结果可由页面读取，人也可在页面操作后由CLI取得新状态。

服务端新提交不会重建或覆盖正在运行的页面。本机UI活跃或待核对时，注册和run会限制版本混用；先关闭并核对旧UI，再注册新提交。注册和启动会校验登记work中的受管代码及snapshot，发现本机修改就停止并保留文件；逐文件流式核对Git对象。非受管依赖可以保存在work，snapshot则必须保持干净。run使用另建副本，不会借此检查或执行旧注册work。

当前进程管理属于单个本机客户端进程。正常关闭有完整停止链；强制杀死客户端或系统异常后的旧UI不被新进程盲目按旧PID终止，status会显示未知会话，应先核对并关闭旧本机进程，再使用skill-stop重置旧登记；旧页面仍可访问时拒绝重置，不按旧PID盲目终止。运行内容不承担生产级进程托管或沙箱隔离。

## 示例

[examples/quote-skill](../examples/quote-skill/SKILL.md)是自包含报价示例。CLI与UI共享运行区SQLite；页面保留未提交输入，Agent的CLI更新通过轮询可见，写入核对状态版本。无需UI时仍可独立执行CLI。

旧演示脚本的环境入口仅作兼容或维护用途，例如`node --env-file=受保护配置文件 scripts/skill-demo-seed.mjs`；不要求普通员工编辑环境文件。此脚本只创建缺失的“报价协作 Skill”，已有同名cap会跳过，不覆盖用户修改；启动、关闭仍需独立显式操作。
