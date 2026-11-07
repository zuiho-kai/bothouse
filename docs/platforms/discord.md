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

谁能指挥机器人（`allow_from`）默认就是建机器人的你。群里默认「仅被点名时回复」：@ 谁谁回，不用装判断模型；想让没点名的话也有人接，再开智能判断，见[进阶](../GETTING_STARTED.md#进阶可不装)。

让 AI 帮你配（Claude Code / Codex 里说「帮我把 bothouse 配好接上 Discord」）：它按 [AGENTS.md](../../AGENTS.md) 一次问齐，跑 `bothouse setup apply`。每一步的详细说明见[接入指南](../connect-discord-feishu.md)。

## 3. 确认上线

保存后向导最后一页（或 `setup apply` 输出的 JSON）列出还要你做的事。按下面的顺序做，前一步没做完，后面的看起来都会像「坏了」：

1. **打开 Message Content Intent**：开发者后台 → 你的应用 → Bot → 打开 Message Content Intent 并保存。没开时机器人在线但读不到消息，@ 它也不回。每个机器人都要开。
2. **填所有者**：页面提示「没查到机器人的所有者」时，填上你自己的 Discord 用户 ID（Discord 设置 → 高级 → 打开开发者模式，再右键自己的头像 →「复制用户 ID」）。没填时为了安全机器人谁的话都不听。
3. **把机器人邀请进服务器**：点页面上的邀请链接，选你的服务器。每个机器人都要邀请。
4. **重启生效**：点「重启生效」（或按 `next_steps` 重启 bothouse）。日志里每个机器人都出现 `discord: connected` 才算上线。
5. **试一句**：去频道里 @ 机器人说一句话。

页面上没列出的步骤就是已经好了，跳过。

同一个 token 只能有一个 bothouse 在线：这个机器人已经在别的电脑上跑着时，先停掉旧的。

## 以后

- 再加 QQ、飞书等：管理面板「添加平台」，见[首页](../GETTING_STARTED.md#以后添加或停用平台)。
- 再加一个 Discord 角色：管理面板「添加角色/模型」。
- 暂时不用 Discord：`bothouse module disable discord`；`bothouse module add discord` 恢复。
- 手动写配置（不用向导）：[接入指南附录 A](../connect-discord-feishu.md#附录-a手动接-discord)。
