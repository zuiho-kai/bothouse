# 在 Discord 里用 bothouse

每个角色是一个 Discord 机器人，几个角色可以在同一个频道里一起说话、互相交接。

要准备：

- 每个角色一个不同的 Discord 机器人 token：[开发者后台](https://discord.com/developers/applications) → New Application → Bot → Reset Token，并在同一页打开 **Message Content Intent**。
- 一个你能管理的 Discord 服务器。
- 本机一个已登录的 CLI（`claude`、`codex`、`gemini`……）。多个角色可以全选同一个，见[同模型多成员指南](../single-cli-team.md)。

不需要 NapCat、Node 或 pnpm。

## 1. 装 bothouse

见[首页第 1 步](../GETTING_STARTED.md#1-装)。

## 2. 向导

运行 `bothouse`，浏览器会打开向导。第一页「你想在哪儿用」选 **Discord**，然后按页面点：填机器人 token → 选服务器和频道 → 每个角色选本机 CLI → 人设 → 主角色 → 保存 →「重启生效」。

谁能指挥机器人（`allow_from`）默认就是建机器人的你。多个机器人时向导默认开分流（主角色决定谁回话），见[进阶](../GETTING_STARTED.md#进阶可不装)，不装也能用。

让 AI 帮你配（Claude Code / Codex 里说「帮我把 bothouse 配好接上 Discord」）：它按 [AGENTS.md](../../AGENTS.md) 一次问齐，跑 `bothouse setup apply`。每一步的详细说明见[接入指南](../connect-discord-feishu.md)。

## 3. 确认上线

保存后向导最后一页（或 `setup apply` 输出的 JSON）列出还要你做的事：

- **Message Content Intent 没开（或没查到）**：机器人读不到消息。点链接到开发者后台打开 / 确认。
- **没查到机器人的所有者**：为了安全机器人先谁都不听，按提示填上你自己的 Discord 用户 ID。
- **机器人还没进服务器**：点邀请链接把它拉进去。
- 都没有就是好了。日志里出现 `discord: connected` 就是上线，去频道里 @ 机器人说一句试试。

同一个 token 只能有一个 bothouse 在线：这个机器人已经在别的电脑上跑着时，先停掉旧的。

## 以后

- 再加 QQ、飞书等：管理面板「添加平台」，见[首页](../GETTING_STARTED.md#以后添加或停用平台)。
- 再加一个 Discord 角色：管理面板「添加角色/模型」。
- 暂时不用 Discord：`bothouse module disable discord`；`bothouse module add discord` 恢复。
- 手动写配置（不用向导）：[接入指南附录 A](../connect-discord-feishu.md#附录-a手动接-discord)。
