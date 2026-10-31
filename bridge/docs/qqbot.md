# QQ Bot 官方平台接入指南 / QQ Bot Official Platform Setup Guide

bothouse 通过 [QQ 官方机器人 API v2](https://bot.q.qq.com/wiki/) 连接 QQ，无需第三方适配器，无需公网 IP。

bothouse connects to QQ via the [official QQ Bot Platform API v2](https://bot.q.qq.com/wiki/). No third-party adapter needed, no public IP required.

## 与 QQ (OneBot) 的区别 / Difference from QQ (OneBot)

| | QQ Bot 官方 (`qqbot`) | QQ OneBot (`qq`) |
|--|----------------------|------------------|
| 协议 / Protocol | QQ 官方 API v2 | OneBot v11 (第三方) |
| 适配器 / Adapter | 不需要 / Not needed | 需要 NapCat 等 / Requires NapCat etc. |
| 封号风险 / Ban risk | 无 / None (腾讯官方) | 有 / Possible |
| 公网 IP / Public IP | 不需要 (WebSocket) | 不需要 (WebSocket) |
| 注册 / Registration | 需要开发者认证 / Developer verification required | 仅需 QQ 账号 / QQ account only |
| 群消息 / Group messages | 仅 @机器人 时 / Only when @mentioned | 所有消息 / All messages |

## 架构 / Architecture

```
QQ Open Platform ←WebSocket→ bothouse ←→ Agent (Claude Code / etc.)
```

## 前置条件 / Prerequisites

1. 访问 [QQ 开放平台](https://q.qq.com) 注册开发者账号
   Visit [QQ Open Platform](https://q.qq.com) and register a developer account

2. 创建机器人应用，获取 **AppID** 和 **AppSecret**
   Create a bot application and obtain **AppID** and **AppSecret**

3. 在机器人管理页面配置权限和上线
   Configure permissions and publish in the bot management page

## 步骤 / Steps

### 1. 创建机器人 / Create Bot

1. 登录 [QQ 开放平台](https://q.qq.com)
   Log in to [QQ Open Platform](https://q.qq.com)

2. 点击 **创建机器人** → 填写基本信息
   Click **Create Bot** → fill in basic information

3. 在 **开发 → 开发设置** 中获取 `AppID` 和 `AppSecret`
   Get `AppID` and `AppSecret` from **Development → Development Settings**

### 2. 配置 bothouse / Configure bothouse

在 `config.toml` 中添加 QQ Bot 平台 / Add QQ Bot platform to `config.toml`:

```toml
[[projects.platforms]]
type = "qqbot"

[projects.platforms.options]
app_id = "your-app-id"           # 机器人 AppID
app_secret = "your-app-secret"   # 机器人 AppSecret
sandbox = false                  # 使用沙箱环境（测试用）/ Use sandbox (for testing)
allow_from = "*"                 # 允许的用户 openid，"*" 表示所有 / Allowed user openids, "*" for all
```

**配置项说明 / Configuration options:**

| 参数 / Option | 必填 / Required | 说明 / Description |
|---|---|---|
| `app_id` | ✅ | 机器人 AppID / Bot AppID |
| `app_secret` | ✅ | 机器人 AppSecret / Bot AppSecret |
| `sandbox` | ❌ | 使用沙箱 API（默认 false）/ Use sandbox API (default false) |
| `allow_from` | ❌ | 允许的用户 openid 列表或 `"*"`（默认允许所有）/ Allowed user openids or `"*"` |
| `intents` | ❌ | 自定义事件意图位掩码 / Custom intents bitmask (advanced) |
| `markdown_support` | ❌ | 使用 Markdown 发送（默认 false）；群聊 @用户需要 true / Send Markdown (default false); required for group @user |

### 3. 启动 / Start

```bash
bothouse
```

看到如下日志表示连接成功 / You should see:

```
qqbot: connected to QQ Bot gateway   sandbox=false
qqbot: gateway READY                 session_id=...
```

现在可以在 QQ 群聊中 @机器人 或私聊机器人了！
Now you can @mention the bot in group chats or send private messages!

## 群聊使用 / Group Chat

在群聊中，机器人**仅在被 @提及 时**收到消息。这是 QQ 官方 API 的限制。

In group chats, the bot **only receives messages when @mentioned**. This is a limitation of the official QQ Bot API.

因为进到机器人的每条群消息本来就是点了名的，适配器把它标成 `Message.Mentioned`，团队模式下不会被当旁听消息丢掉 —— 也就是说 QQ 官方 Bot 的群天然是「只回答被叫到的」。

Because every group message that reaches the bot already @-ed it, the adapter marks it `Message.Mentioned`, so team mode does not drop it as background chatter — a QQ official-bot group is inherently "only answer when called".

每个用户在每个群中拥有独立的会话。
Each user gets an independent session per group.

## 私聊 / Private Messages (C2C)

支持一对一私聊消息，无需 @提及。
One-on-one private messages are supported without @mention.

私聊消息标成 `Message.Direct`，`core/gate_local.go` 的内置忙碌规则据此认得出这是一个 DM。
Private messages carry `Message.Direct`, which is how `core/gate_local.go`'s built-in busy rule knows it is a DM.

## 支持的消息类型 / Supported Message Types

| 类型 / Type | 接收 / Receive | 发送 / Send |
|------------|----------------|-------------|
| 文字 / Text | ✅ | ✅ |
| 图片 / Image | ✅ | ❌ |
| 语音 / Voice | ❌ | ❌ |
| @提及 / @mention | ✅ (自动剥离) | ✅ 群聊，见下方限制 / Group chats, subject to limits below |

### 发送群聊 @ 提及 / Sending group mentions

`qqbot` 实现 `core.AtMentionSender`，支持 CLI `--at-users` / `--at-all` 和发送 API 的 `at_users` / `at_all`。以 [QQ 官方「文本交互」文档](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/text-chain.html) 为准（2026-10-26 更新）：

`qqbot` implements `core.AtMentionSender` for CLI `--at-users` / `--at-all` and API `at_users` / `at_all`. The [official text interaction documentation](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/text-chain.html), updated 2026-10-26, defines these limits:

| 请求 / Request | 条件 / Requirements |
|---|---|
| `--at-users MEMBER_OPENID` | 群聊；配置 `markdown_support = true`；使用该群消息事件 `author.member_openid`，多个用逗号分隔 / Group chat, Markdown enabled, member openids from group events, comma-separated |
| `--at-all` | 群聊；文本或 Markdown 均可；机器人必须是该群管理员，每群每天一次 / Group chat, text or Markdown; bot must be a group admin, once per group per day |

例如，在已经有活跃会话的项目中发送 / For a project with an active group session:

```bash
bothouse send -p my-project -s qqbot:GROUP_OPENID:MEMBER_OPENID --at-users MEMBER_OPENID -m "任务完成"
```

会话 key 使用当前活跃会话的实际值；开启共享群会话时可能不同。不能用 QQ 号、昵称或私聊 `user_openid` 代替群成员 `member_openid`，适配器不会自动查询成员。私聊带 @ 参数、未开启 Markdown 的 @用户、空或含标签字符的 ID 会报错，不会静默发送普通文本。

Use the actual active session key; shared group sessions can differ. Supply the group's `member_openid`, not a QQ number, nickname or C2C `user_openid`; there is no automatic member lookup. Mentions in private chats, @user without Markdown, and empty/malformed IDs return errors instead of silently sending plain text.

长回复只在第一片带 @ 标签，标签不会跨片拆开；被动回复仍受 QQ 的时效和次数限制。权限或每日额度错误原样返回，由 QQ 判定，不在本地猜测剩余额度。本功能已用本地模拟 API 验证，真实群通知及机器人之间互叫尚需实机验收。

Long replies include mention tags only in the first chunk, without splitting tags. Passive reply timing/count limits still apply. QQ decides permissions and daily quotas; API failures are returned to the caller. Local simulated API tests cover request behavior; live notifications and bot-to-bot handoffs still need acceptance testing.

## 常见问题 / FAQ

**Q: 连接失败？/ Connection failed?**
- 确认 `app_id` 和 `app_secret` 是否正确 / Verify `app_id` and `app_secret` are correct
- 检查网络是否能访问 `api.sgroup.qq.com` / Check network access to `api.sgroup.qq.com`
- 如果使用沙箱环境，确认 `sandbox = true` / If using sandbox, set `sandbox = true`

**Q: 收不到群消息？/ Not receiving group messages?**
- 群消息仅在 @机器人 时触发 / Group messages require @mention
- 确认机器人已被添加到群中 / Verify the bot has been added to the group
- 检查 `allow_from` 配置 / Check `allow_from` configuration

**Q: 提示 token 获取失败？/ Token acquisition failed?**
- 确认 `app_secret` 正确 / Verify `app_secret` is correct
- 检查机器人是否已上线（未上线只能使用沙箱）/ Check if the bot is published (unpublished bots can only use sandbox)

**Q: 断线重连？/ Reconnection?**
- bothouse 内置自动重连机制，断线后会自动尝试恢复（最多 30 次）
- bothouse has built-in automatic reconnection with resume support (up to 30 attempts)

## 沙箱环境 / Sandbox

开发测试时可以使用沙箱环境，设置 `sandbox = true`。沙箱环境使用独立的 API 端点 (`sandbox.api.sgroup.qq.com`)，不影响生产环境。

For development and testing, set `sandbox = true`. The sandbox uses a separate API endpoint (`sandbox.api.sgroup.qq.com`) and doesn't affect production.
