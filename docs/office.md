# Office适配

客户端使用成熟库处理原件：ExcelJS读取和写回XLSX，Mammoth读取DOCX，docx的patchDocument填写现有Word模板。CLI和图形桥接使用同一组客户端模块，服务端只通过统一内容接口保存原件与Git提交，不维护额外的Office登记。

## 读取

```sh
node src/cli.mjs preview 报价预算.xlsx
node src/cli.mjs preview 拍摄说明.docx
node src/cli.mjs preview 资料包 office/预算.xlsx
```

预览返回实际提交号、纯文本块或工作表单元格及截断状态。Word提取标题、段落、表格，Excel提取单元格和已有公式缓存；不执行公式、不请求外链、不将转换出的HTML直接交给浏览器。预览能力不等于完整办公排版还原。

## 写回

先stat或preview后stat取得当前token，准备JSON修改文件，再执行：

```sh
node src/cli.mjs office-write 报价预算.xlsx --file ./单元格修改.json --token CURRENT_TOKEN
node src/cli.mjs office-write 合同模板.docx --file ./模板填写.json --token CURRENT_TOKEN
```

Excel修改文件：

```json
{"cells":[{"sheet":"报价预算","cell":"B6","value":2}]}
```

每项value接受文本、有限数字、布尔值或null，不把文本当公式。ExcelJS在载入的工作簿上修改指定单元格，保留其支持的其他工作表、单元格样式与公式。修改后清理公式缓存并标记打开时重算，当前预览显示公式文本，避免继续展示旧结果。复杂图表、嵌入对象等完整保真不属于该适配保证；需要完整Office能力时仍可下载原件并通过统一上传保存。

Word填写文件：

```json
{"replacements":{"customer":"示例客户","quote":"4800 元"}}
```

原件正文必须存在相应的`{{customer}}`和`{{quote}}`占位符，缺少任意标记会报错。通过docx的模板补丁保留原包结构和原样式，不从只读预览重新生成整篇文档。这一入口负责模板文本填写，不把任意富文本段落编辑伪装成无损修改。

本地界面对应action为`office-write`，字段为name、可选entry、changes及token。写回先检查调用者token、读取期间commit一致性，最终上传仍使用原token；期间发生外部修改返回409，保留事件回执且不自动重试。临时输出只保存到客户端工作区并在上传后清理。

## 资源限制

原件最多16MiB，ZIP最多2000条目，展开总量最多64MiB；所有XML单份最多8MiB、合计24MiB，并限制节点和深度。处理前预检整个ZIP与XML，拒绝DTD、宏和外部工作表。预览最多8张工作表、每表200行30列、800个Word块，总文本30万字符。具体常量维护在src/preview/limits.mjs。

## 上游依据

- [ExcelJS官方文档](https://github.com/exceljs/exceljs#reading-xlsx)：工作簿读取、单元格修改与writeBuffer。
- [Mammoth官方文档](https://github.com/mwilliamson/mammoth.js)：DOCX语义读取、默认禁止外部文件访问及转换安全边界。
- [docx patchDocument官方接口](https://docx.js.org/api/functions/index.patchDocument.html)：保留现有文档结构的占位符填写。

ExcelJS的uuid传递依赖通过package.json overrides固定到修复版本，覆盖范围仅限ExcelJS。其余上游包的弃用提示与当前适配能力分别理解，升级后重新运行读写及样式保留测试。
