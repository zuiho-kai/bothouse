# 在飞书 / Lark 里用 bothouse

扫码自动建一个飞书机器人，在飞书群或私聊里对话。飞书这一轮只接一个机器人。

要准备：

- 一个飞书（或 Lark）账号，能在企业里建应用。
- 本机一个已登录的 CLI（`claude`、`codex`、`gemini`……）。

不需要 Discord、NapCat、Node 或 pnpm。

## 1. 装 bothouse

见[首页第 1 步](../GETTING_STARTED.md#1-装)。

## 2. 向导

运行 `bothouse`，浏览器会打开向导。第一页「你想在哪儿用」选 **飞书 / Lark**，然后：用飞书扫码（自动建好机器人，拿到 app_id / app_secret）→ 选默认群 → 选本机 CLI → 人设 → 保存 →「重启生效」。

不用浏览器：先 `bothouse feishu setup` 扫码，再按 [AGENTS.md](../../AGENTS.md) 的说明用 `bothouse setup apply`（`"platform": "feishu"`）。

## 3. 确认上线

重启后在飞书里私聊机器人或在群里 @ 它说一句，它回话、日志里有这条消息就是上线了。怎么验证、飞书上目前没有的功能，见[接入指南附录 B](../connect-discord-feishu.md#附录-b飞书命令行)。

## 以后

- 再加 QQ、Discord 等：管理面板「添加平台」，见[首页](../GETTING_STARTED.md#以后添加或停用平台)。
- 暂时不用飞书：`bothouse module disable feishu`；`bothouse module add feishu` 恢复。
