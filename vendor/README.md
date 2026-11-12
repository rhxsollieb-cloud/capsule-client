# 第三方源码包

xlsx-0.20.3.tgz来自SheetJS官方CDN，是该项目当前推荐的Community Edition版本。官方说明npm注册表的xlsx停留在旧0.18.5，因此本项目不从该旧注册表版本安装。

- 下载地址：https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
- 官方安装及vendoring说明：https://docs.sheetjs.com/docs/getting-started/installation/nodejs/
- SHA-256：8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8
- 包内含LICENSE；安装来源在package.json与package-lock.json中记录为本地file依赖。

该包用于兼容读取ExcelJS不能读取的合法XLSX。SheetJS CE不会用于将兼容原件重新导出覆盖，以免丢失其未支持的原始样式和对象。升级时重新从官方固定版本地址取得源码包，核对校验和并运行Office预览、写回与兼容边界测试。
