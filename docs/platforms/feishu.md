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

## 4. 从群聊或私聊直接运行本机 Codex

向导或扫码新建的独立飞书 / Lark Codex 角色，在配置了 `allow_from` 账号白名单且未启用机器人协作时，默认直接处理任务。私聊直接发任务，群里 @ 机器人后发任务。单独 @ 时，机器人根据前面的群消息接话。直接回复机器人的消息也可以继续对话。机器人在本机执行，并把结果回复到收到任务的会话。

群历史补入和不带 @ 的群回复需要应用开通 `im:message.group_msg`。只有接收 @ 权限时，仍可用 @ 加正文或直接回复并 @ 机器人。开启话题隔离时，机器人沿用话题自己的会话和引用上下文。

文件读写和命令运行使用这个角色的 Codex 权限与工作目录。在任务里写明项目的本机路径，或用角色现有的工作目录。可用 `allow_chat` 限定允许触发该角色的群。

要指定任务模式，在 BotHouse 当前使用的 `config.toml` 里找到这个角色的 `[[projects]]` 段，与 `name` 同级设置 `inject_team_rules`。设为 `true` 时按团队规则交接，设为 `false` 时直接处理。改动后在管理面板重新加载配置，再在对应群聊或私聊里让机器人执行 `/new`，用新会话加载规则。修改 `allow_from` 或 `allow_chat` 后，重启 BotHouse 以应用新的访问范围。

## 以后

- 再加 QQ、Discord 等：管理面板「添加平台」，见[首页](../GETTING_STARTED.md#以后添加或停用平台)。
- 暂时不用飞书：`bothouse module disable feishu`；`bothouse module add feishu` 恢复。
