---
name: quote-skill
description: 计算并调整一项报价的数量、单价和总金额；需要在本机界面与 Agent CLI 之间共享、查看或修改当前报价时使用。
---

# 报价计算器

维护一项人民币报价。数量是 0–1,000,000 的整数，单价最多两位小数且不超过 10,000,000.00 元，总金额由数量与单价计算。只需 Node.js 24 或以上，无须安装依赖。

## 通过客户端使用

将下列 `CAP名称` 换成当前代码 cap 的全名。客户端同步代码并提供该 cap 的本机持久状态目录。

```sh
capsule run CAP名称 -- --help
capsule run CAP名称 -- state
capsule run CAP名称 -- set 24 129.50
```

先读取当前报价；基于已读数据调整时，可将返回的 `version` 作为 `set` 的 `--version`，避免覆盖他人之后保存的报价。发生版本冲突后重新读取并核对，不自动换版本重试。

```sh
capsule run CAP名称 -- set 24 129.50 --version 2
```

需要交互界面时，先 `capsule skill-register CAP名称`，再用 `capsule skill-start CAP名称` 启动；用 `capsule skill-status CAP名称` 查询，`capsule skill-stop CAP名称` 关闭。CLI 不依赖界面进程，二者共用同一个 `CAPSULE_SKILL_STATE/state.sqlite`。

## 独立运行

在此 skill 根目录执行；`CAPSULE_SKILL_STATE` 必须指向代码目录之外的本机运行状态目录，不在 cap 内写入状态。

```sh
CAPSULE_SKILL_STATE=/absolute/local/quote-state node scripts/cli.mjs state
CAPSULE_SKILL_STATE=/absolute/local/quote-state node scripts/cli.mjs set 10 99.90
CAPSULE_SKILL_STATE=/absolute/local/quote-state node scripts/ui.mjs 3>/absolute/local/quote-ready.json
```

界面只监听 `127.0.0.1` 随机端口，在启动后向描述符 3（或 `CAPSULE_SKILL_READY_FD`）写入一行 `{"url":"http://127.0.0.1:PORT/"}`。使用该地址打开界面，Ctrl-C 关闭进程。首次访问会初始化状态库与默认报价；之后的state查询不修改已保存报价或生成新版本。界面每秒查询共享状态，已有未提交输入时保留输入并提示外部更新。界面保存必须核对原版本。

CLI 成功向标准输出返回 JSON；失败向标准错误返回 JSON 并以非零状态退出。缺少状态目录配置时明确失败，不在当前目录创建数据库。
