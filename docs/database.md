# SQLite表格读写

数据库cap仍只支持SQLite。服务端使用Node官方node:sqlite驱动执行参数化语句、事务与外键检查。客户端从SQLite自身读取表、主键和列结构，使用Tabulator呈现网格，不维护额外的表登记或查询库。

## 使用

第二列切换数据表，中央双击业务单元格编辑，点击“保存修改”将当前页变化作为一次事务提交。排序与筛选作用于当前页。修改保留读取时的token；切换数据表后草稿继续保留，后台新版本不会替换其基线。保护单位是整个cap，即使改动不同数据表或行，旧token也不能覆盖新版本。失败保留修改；版本冲突需核对后重新读取，暂时占用或待处理事件先查询状态。

网格不编辑主键、生成列、BLOB或没有完整非NULL主键的行；系统媒体表只通过文件接口修改。视图、自定义SQL查询结果及无主键表只读。超过100列的表拒绝网格适配，应使用SQL渐进查询。翻页或执行SQL前需先处理当前表修改，避免把其他页面结果作为原草稿基线。

CLI与Agent使用相同适配：

```sh
node src/cli.mjs table 素材记录 media_assets --limit 20
node src/cli.mjs table-write 素材记录 media_assets --file ./行修改.json --token CURRENT_TOKEN
```

修改文件为操作数组：

```json
[
  {"operation":"update","key":{"id":"M002"},"values":{"status":"已准备"}},
  {"operation":"insert","values":{"id":"M007","title":"新参考","kind":"image","status":"待准备"}},
  {"operation":"delete","key":{"id":"M003"}}
]
```

字段名从数据库实际结构校验并引用，单元格值始终绑定参数。更新和删除要求全部主键字段，禁止NULL定位；一次接受1至100项操作，约束失败整批回滚。插入可指定主键，更新不能更改主键或生成列。CLI的值还可用`{"type":"bigint","value":"123"}`或`{"type":"blob","base64":"AA=="}`，不受网格的BLOB编辑限制。最终写入仍携原token，经服务端统一write接口生成Git提交。

数据库媒体删除遵循业务表实际声明的外键动作：NO ACTION或RESTRICT可阻止删除，CASCADE或SET NULL则按SQLite规则执行。媒体文件与记录由统一文件接口协调，不能仅凭有引用就断言删除一定被阻止。

本地图形action为table（name、可选table、limit、offset）与table-write（name、table、changes、token）。读取返回当前cap记录、schema及分页items。现有query/write SQL能力继续承担建表、复杂事务和不适合网格的操作。

## 上游依据

- [Node官方SQLite驱动](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)：连接、预处理语句与参数绑定。
- [Tabulator编辑文档](https://www.tabulator.info/docs/6.x/edit/)：单元格编辑、编辑事件及可编辑范围。

Tabulator仅处理呈现与草稿；持久权限、媒体保护、事务、token和版本提交由现有业务服务执行。
