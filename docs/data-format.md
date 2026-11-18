# 胶囊数据规范：Agent读取入口

本页说明当前客户端对应的API v3数据模型，帮助Agent选择正确接口。它随客户端发布，可用`capsule guide data`离线按行读取；它不代表已与当前远端协商成功。连接后先用`health`核对服务端，具体请求契约维护在[服务端API说明](../../capsule-server/docs/api.md)，参数以`help 命令 --json`为准。

## 先区分四个概念

| 概念 | 含义 | 查询入口 |
| --- | --- | --- |
| cap名称 | 全库唯一实体身份；同一cap可以有多个展示位置 | stat 名称 |
| 虚拟路径 | 知识组织与挂载，不是原件实际磁盘路径 | ls /、where 名称、position 路径 |
| entry | 当前目录cap内的原生相对路径 | entries 名称 |
| commit与token | commit指某次Git内容及元数据版本；当前token保护写入 | stat 名称、history 名称 |

同一个cap的多处挂载指向同一实体，不复制内容。两个不同cap独立拥有内容和Git，不通过挂载或相对路径共享数据。cap是管理、版本与隔离单位；已提交版本保持不变，更新在原cap形成新提交。

知识库界面看似文件项目，物理存储不随虚拟路径搬动。名称是当前库的定位键，清除后同名重建属于新实体，旧token不能跨重建使用。名称按服务端规则归一化并核对唯一性；虚拟挂载末段等于完整cap名称。名称可以是中文，code的SKILL.md内另有机器用skill name，区别见`guide skills`。

## 数据形态与详述来源

服务端顶层catalog.sqlite统一保存元数据、版本关联、虚拟挂载与事件。cap本身没有cap.json，也不另建cap登记库；原件继续使用自身格式，通过统一接口管理。

| kind | 物理形态 | 默认正文或详述 |
| --- | --- | --- |
| text | 平铺单文件 | 该文件自身 |
| image、audio、video | 平铺单文件 | 顶层元数据details；原件另走content |
| excel、word、file | 平铺单文件 | 顶层元数据details；Office原件另走Office或content |
| markdown | 独立目录 | README.md；自有附件限定assets/ |
| files | 独立目录 | 说明.md；其他原生文件用entry访问 |
| database | 独立目录 | 说明.md；data.sqlite与自有media/ |
| code | 独立Skill目录 | SKILL.md；固定scripts/cli.mjs，可选scripts/ui.mjs |

名称、kind与最多180字符的简述用于轻量列表。详述按需通过details读取；文字类复用正文，不保存第二份详情。媒体/Office等只在顶层保存一份details，详述修改也受token与版本保护。属性弹窗按Markdown呈现，保存的仍是原始文本。

员工、密码哈希、登录会话与兼容长期凭据摘要、cap非管理员三档权限、审计和备份登记都在服务端顶层SQLite，由access_*及backup_records维护，不增加cap内部登记或Git字段。人和Agent都通过连接页或CLI login使用同一用户名密码登录，默认共享本机配置的12小时会话及权限；Agent非交互从--password-file文件或-读取密码，不传明文argv。先用me核对实际身份，身份保存与切换见[登录说明](login.md)。

账户分admin和普通员工editor。admin管理全库；cap统一为全部非管理员设置read/edit/none，新cap默认edit。不逐员工授权。所有挂载共用同一cap权限，不继承父节点，同名重建不继承旧规则，内容回撤也不改变权限。只读可下载并复制，副本有独立数据和Git、默认读写；无访问隐藏源cap并拒绝读取、下载与复制。响应permissions是当前主体能力投影，不能由客户端自行授予。精确规则及备份见[管理说明](../../capsule-server/docs/access.md)和[备份恢复](../../capsule-server/docs/backups.md)。

当前stat的公开记录示意如下，commit/token的示意文字不能直接用于请求；非code不带runtime。虚拟位置、详述全文和本机运行状态均按需另查，不堆进每条概要。

```json
{"name":"报价协作 Skill","kind":"code","description":"计算报价","runtime":{"engine":"node","entry":"scripts/cli.mjs"},"commit":"实际Git提交号","token":"当前实体版本校验值"}
```

单文件Git位于系统版本区，目录cap有自己的Git。不要由展示路径推断磁盘位置，不手工改托管文件、Git或登记SQLite。`paths`只报告本机客户端目录，不提供远端原件真实路径。

sync按服务端地址/cap隔离缓存，持锁后查询本次目标提交；同提交与已有完整对象直接复用，新版本可增量下载。缓存头表示已发布的本次观察版本，不代表服务端此后没有变化；退出失败也需按诊断核对是否已发布。run和注册从选定提交创建不同本地副本，持久state独立，详见[缓存架构](architecture.md#同步与运行)与[Skill说明](skills.md)。本地克隆不等于重复网络下载。

## 统一接口如何选择

以下使用已安装的短命令`capsule`；在客户端源码目录也可替换为`node src/cli.mjs`。

```sh
capsule help --json
capsule overview
capsule ls / --limit 20
capsule stat 手册.md
capsule details 手册.md --from 1 --limit 40
capsule entries 手册.md --limit 20
capsule read 手册.md README.md --from 1 --limit 40
capsule where 手册.md
```

list是实体概要，ls是虚拟位置，entries是cap自身原生文件；它们不是三份数据。details明确返回source，表明内容来自原件正文还是顶层元数据。普通读写传cap名称；目录条目额外传entry，不把虚拟路径传成文件系统路径。

正文和详情用read/details读取，用write/write-details保存；二进制原件用get/put流式传输。Office网页编辑经专用会话保存到同一cap版本，编辑器收集变化不等于cap已经提交。不要把DOCX/XLSX二进制当文本写回。

批量导入原文、单文件、SQLite 或带附件的原生目录使用 `import-batch`。每项建立独立 cap，可同时指定虚拟挂载路径。清单格式、预演与失败回执见[CLI 工作流程](cli-parity.md#常用流程)。

query按类别检索实际文本或只读查询SQLite；search按虚拟范围去重查cap，query筛概要，text才扫描实际正文或详述。不新增cap内部查询索引。search的total、offset、nextOffset按候选cap计数，scanned与incomplete说明覆盖；它不扫描Office二进制、媒体内容或SQLite业务单元格。

## 写入、组织与回撤

实体写入携当前stat/read/details返回的token。token是不可自行构造的版本校验值，不能拿commit代替，也不能拿历史stat结果当当前可写基线。VERSION_CONFLICT或实际版本变化时重读、核对和合并，保留草稿；不自动换token强写。其他409按code诊断，不一概当成版本冲突。

多人连接同一服务端，普通正文/SQLite同时保存会逐一核对原token。`activity 名称`只读查询全部未过期编辑会话、真实排队事件、Office状态和队列诊断，不注册心跳。图形客户端会排除自身tab的编辑会话，CLI没有这个过滤；会话数不是人数。编辑提示非排他、会过期，不等于锁定或保存成功；查询失败不能当作无人编辑。LOCK_BUSY先核对占用，EVENT_BUSY先查原事件；恢复失败与工作区占用另按code处理，不绕过token。心跳及界面呈现由[界面说明](ui.md#并发活动提示)维护。

长期编辑另用顶层SQLite的cap租约，content/details/database独占、office协作共享，不在cap内部加锁登记。lease-status/acquire/renew/release与--lease提供Agent入口；EDIT_BUSY显示当前持有者，EDIT_LEASE_LOST保留草稿并重新获取，不能自动换token强写。粒度、快速释放和异常回收见[并发说明](../../capsule-server/docs/concurrency.md)。

位置move/unmount使用position取得的子树token。整cap清除使用removal预览返回的实体token与mountsToken，两者都要核对。organize用独立baseline预演mount/move/unmount，正式提交只涉及位置事务，续页查receipt，不能重放计划翻页。

管理员用 `rename 旧名称或虚拟路径 新名称 --dry-run --out 改名计划.json` 预演，核对后以 `rename --plan 改名计划.json` 提交。指定精确源挂载和 `--into` 可同时移动该处整棵子树。同一 cap 保留数据、历史和权限，全部挂载随名称更新。改名成功后使用新名称或新虚拟路径访问。正文的已知引用可通过 `edit --prepare` 与 `edit --plan` 按原件、原版本精确替换，外部脚本按新路径更新。客户端同步缓存和本机 Skill 登记按名称索引，改名后需使用新名称同步或登记。

revert按目标commit恢复内容和当时元数据，然后生成新提交，保留历史；回撤后仍使用当前名称和挂载。回撤和清除经过持久事件队列，先查原event/eventId的终态再判断结果。网络中断、超时或uncertain先查询实际结果与原事件。

断链只移除当前叶挂载，保留cap及版本；清除删除整个cap、全部挂载和独立Git，不能通过revert找回。清除前核对阻止原因和完整范围；有子挂载、未完事件或活跃Office时可能被拒绝。

永久清除、全局位置organize及其回执只允许admin。员工和凭据各用自身revision；cap三档访问使用自己的revision，不能拿cap token代替。凭据撤销、登录会话到期、员工禁用或权限改变在请求和实际写入/队列执行前重查；审计以实际主体、credentialId及eventId归因，不保存正文、密码与令牌。权限降为只读或无访问会使旧编辑占用失效，不因重新开放而复活；Office只读使用view配置，保存仍核对原身份与版本。

## SQLite、媒体和日志

database当前只支持SQLite。业务行经query/write/table/table-write管理，媒体经put/get/remove-entry管理；_cap_files由统一媒体服务维护，不由业务SQL直接插入、改写或删除。

大媒体保存在该database cap自有media/文件区，SQLite记录路径、大小和关联。业务表可以用外键引用_cap_files(path)，媒体删除遵循其外键策略：默认NO ACTION或显式RESTRICT会阻止仍被引用的媒体删除，CASCADE/SET NULL则按业务DDL处理关联。数据库内文件区不是第二个跨cap资源库。

日志放业务表，不新建log类别。客户端运行后尝试记录本机client.sqlite；只有显式run --log-cap选择database cap才写入cap_run_logs。本机或远端记录失败会返回实际运行回执与logError，不能把记录失败当作工具未执行，也不为补日志重新运行。

## 渐进读取与说明边界

先查询范围，再读正文。read/details保留lines.nextLine，list/ls/entries/query保留nextOffset；按实际返回位置续读。--fields、--max-chars、--out控制输出，truncated/dataOmitted表示信息未完整返回，不代表真实内容为空。

guide查询的是本客户端随包说明：无topic先列主题，data讲数据模型，skills讲Skill运行约定；每次返回行范围与续读位置。它不读取业务cap、不创建登记、不启动代码，也不自动取代任何Skill自身的SKILL.md。

具体Skill用details 名称读取SKILL.md，再用help run和skill-status了解实际本机状态。无UI的Skill可直接run；选中带页面的 Skill 时，工作台会在本机启动或复用协作页。客户端离线指南、远端cap内容和本机运行状态分别查询，不把其中一种当成另外两种的证明。
