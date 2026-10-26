# QQ 平台接入指南 / QQ Platform Setup Guide

bothouse 通过 [OneBot v11](https://github.com/botuniverse/onebot-11) 协议连接 QQ，需要搭配一个 OneBot 实现（如 NapCat）使用。

bothouse connects to QQ via the [OneBot v11](https://github.com/botuniverse/onebot-11) protocol. You need a OneBot implementation (e.g., NapCat) running alongside.

## 架构 / Architecture

```
QQ Client ←→ NapCat (OneBot v11) ←WebSocket→ bothouse ←→ Agent (Claude Code / etc.)
```

## 前置条件 / Prerequisites

- 一个 QQ 账号用作机器人 / A QQ account to act as the bot
- [NapCat](https://github.com/NapNeko/NapCatQQ) 或其他 OneBot v11 实现 / NapCat or another OneBot v11 implementation

## 步骤 / Steps

### 1. 部署 NapCat / Deploy NapCat

推荐使用 Docker（最简单）/ Docker is recommended (easiest):

```bash
docker run -d \
  --name napcat \
  -e ACCOUNT=<你的QQ号> \
  -p 3001:3001 \
  -p 6099:6099 \
  mlikiowa/napcat-docker:latest
```

首次启动需要扫码登录 / First launch requires QR code login:

```bash
docker logs -f napcat
```

在日志中找到二维码，用手机 QQ 扫码登录。
Find the QR code in the logs and scan it with your QQ mobile app.

### 2. 配置 NapCat 正向 WebSocket / Configure Forward WebSocket

打开 NapCat WebUI / Open the NapCat WebUI:

```
http://localhost:6099
```

在网络配置中：/ In network settings:
- 启用 **正向 WebSocket** (Forward WebSocket) / Enable **Forward WebSocket**
- 端口设为 `3001`（默认）/ Port: `3001` (default)
- 如果需要鉴权，设置 Access Token / Set Access Token if needed

### 3. 配置 bothouse / Configure bothouse

在 `config.toml` 中添加 QQ 平台 / Add QQ platform to `config.toml`:

```toml
[[projects.platforms]]
type = "qq"

[projects.platforms.options]
ws_url = "ws://127.0.0.1:3001"  # NapCat 正向 WebSocket 地址
token = ""                       # 可选：Access Token（需与 NapCat 一致）
allow_from = "*"                 # 允许交互的 QQ 号，"*" 表示所有人
```

**`allow_from` 配置说明 / `allow_from` options:**
- `"*"` — 允许所有人 / Allow everyone
- `"12345"` — 仅允许 QQ 号 12345 / Only allow QQ user 12345
- `"12345,67890"` — 允许多个 QQ 号 / Allow multiple QQ users

### 4. 启动 / Start

```bash
bothouse
```

看到如下日志表示连接成功 / You should see:

```
qq: connected to OneBot   url=ws://127.0.0.1:3001
qq: logged in             qq=123456789 nickname=MyBot
```

现在可以在 QQ 上私聊或群聊机器人了！
Now you can chat with the bot via QQ private or group messages!

## 群聊使用 / Group Chat

支持群聊消息。默认每个用户在群里各有独立会话；配置 `share_session_in_channel = true` 后，整个群共用一个会话（多人协作、团队模式需要这个）。

Group chat is supported. By default each user gets an independent session in the group; set `share_session_in_channel = true` to share one session per group, which multi-person and team-mode use needs.

群聊里 @ 机器人、或**引用回复机器人的某条消息**都算叫到它：消息会带上"被叫到"的标记进入引擎，团队模式下不会当作旁听消息丢掉。@ 别人的消息保留 `@昵称` 原文，模型能看到点的是谁。只发一个 @ 不带文字也会起一轮，交给模型自己看上文判断要做什么。

In a group, @-mentioning the bot or **replying to one of its messages** counts as calling it: the engine marks the message as addressed, so team mode does not drop it as background chatter. An @ of somebody else stays in the text as `@nickname`, so the model can see who was addressed. A bare @ with no text still starts a turn; the model reads the context to decide what to do.

## 团队模式 / Team Mode

同一平台可以挂多个角色（多个 QQ 号），配合 `share_session_in_channel` 使用。群里没有 @ 任何机器人的消息只作背景，不触发回复；@ 了谁、引用了谁，就由谁回答。

Several roles (QQ accounts) can run on the same platform together with `share_session_in_channel`. Group messages that @ nobody are background only; whoever was @-ed or quoted answers.

判断"点的是谁"有两条路：

1. **@ 段**：@ 的是本机器人 → 叫到它；@ 的是同进程里另一个 QQ 号 → 交给那个机器人，本机器人不抢。
2. **按名字**：行首写"小助手 你看一下"（和 @ 一样能点名），同 Discord 的规则。

两个都要求同一个进程里跑着这些角色：`qq` 平台在登录后按 QQ 号登记自己，互相才认得出来。

Two things decide who was called:

1. **An at segment**: this bot → it answers; another QQ account of this process → that bot answers, this one stays out.
2. **A name at a line start** ("小助手 你看一下"), the same rule Discord uses.

Both need the roles to run in one process: each `qq` platform registers itself by QQ number after login, which is how they recognise each other.

> 任务板、进度卡、副任务表这些大卡片只有 Discord 支持。QQ 上相应的内容会退化成纯文本消息，功能不受影响，只是没有卡片。
>
> Task boards, progress cards and the sub-task table are Discord-only. On QQ the same content degrades to plain text messages: nothing breaks, there is just no card.

## 支持的消息类型 / Supported Message Types

| 类型 / Type | 接收 / Receive | 发送 / Send |
|------------|----------------|-------------|
| 文字 / Text | ✅ | ✅ |
| 图片 / Image | ✅ | ✅ |
| 文件 / File | ✅ | ✅（需配 `http_url`，群文件走 `upload_group_file`） |
| 语音 / Voice | ✅ (需配置 STT) | ❌ |
| @提及 / @mention | ✅ (识别为"叫到机器人") | ✅（`ReplyWithAt`，真 @ 提醒） |
| 引用回复 / Quote reply | ✅（引用内容作为上下文） | ❌ |

`http_url` 是 NapCat 的 HTTP API 地址（如 `http://127.0.0.1:3000`），配了之后收文件会走 `get_group_file_url` / `get_file` 拿新链接，发文件走 HTTP，避免 WebSocket 大包和跨容器路径问题。

`http_url` is NapCat's HTTP API endpoint (e.g. `http://127.0.0.1:3000`). With it set, receiving a file re-resolves an expiring CDN link via `get_group_file_url` / `get_file`, and sending a file goes over HTTP instead of the WebSocket, avoiding large frames and cross-container path issues.

## 接到 DSH 频道 / Bridging into DSH channels

DSH（`dsh/`）的频道要接 QQ，**不需要写 QQ 插件**：DSH 的外部 bot 一律走 `cloud_web` 协议（`dsh/collab/README.md`「接入 cc-connect 成员」），QQ 则由 cc-connect 当平台接进来。一个项目同时挂这两个平台，QQ 群和 DSH 频道就是同一个 agent 的两个入口。

There is **no QQ plugin to write** for DSH channels: DSH takes external bots over the `cloud_web` protocol (`dsh/collab/README.md`), and QQ is a cc-connect platform. One project mounting both platforms makes a QQ group and a DSH channel two doors into the same agent.

```
QQ 群 ←→ NapCat ←WebSocket→ cc-connect ⟨qq 平台⟩
                                    ↕ 同一个 agent / 同一份记忆
DSH 频道 ←WebSocket→ cc-connect ⟨cloud_web 平台⟩
```

```toml
[[projects]]
name = "ju"

[[projects.platforms]]
type = "qq"
[projects.platforms.options]
ws_url = "ws://127.0.0.1:3001"
allow_from = "*"
share_session_in_channel = true

[[projects.platforms]]
type = "cloud_web"
[projects.platforms.options]
transport = "websocket"
base_url = "http://127.0.0.1:<DSH 端口>"
ws_url = "ws://127.0.0.1:<DSH 端口>/cloud-web/ws?bot=ju&name=%E6%A9%98"
token = "${CONEST_COLLAB_BOT_TOKEN}"
allow_from = "*"
share_session_in_channel = true
group_reply_all = false
```

两边各自是一个会话（`qq:<群号>`、`cloud_web:<频道>`），共用同一个 agent 和工作目录，所以在 QQ 群里交代的事，DSH 频道里接着问也记得。

Each side is its own session (`qq:<group id>`, `cloud_web:<channel>`), shared agent and working directory: work started in a QQ group is still there when you ask from the DSH channel.

`share_session_in_channel = true` 两边都要开，否则群里每人一个会话，@ 谁都不像一个群。

Set `share_session_in_channel = true` on both, otherwise each person in the group gets their own session and the group does not behave like one channel.

> 这条链路目前**没有真机验过**：QQ 侧和 `cloud_web` 侧各自的收发都有测试，但「QQ 群 → cc-connect → DSH 频道 → 回复回 QQ 群」这个完整来回还没在真实环境跑过。#345 的第 4 部分就是这件事。
>
> This path is **not verified end to end yet**: each side has its own tests, but a full QQ group → cc-connect → DSH channel → reply round trip has not run against real services. That is the fourth part of #345.

## 常见问题 / FAQ

**Q: 连接失败？/ Connection failed?**
- 确认 NapCat 正在运行且端口正确 / Check that NapCat is running and port is correct
- 确认 NapCat 已启用正向 WebSocket / Verify Forward WebSocket is enabled in NapCat
- 如果设置了 Token，确保两边一致 / If using Token, ensure it matches on both sides

**Q: 收不到消息？/ Not receiving messages?**
- 检查 `allow_from` 配置，确认你的 QQ 号在允许列表中 / Check `allow_from` includes your QQ ID
- 查看 NapCat 日志确认消息是否正确转发 / Check NapCat logs for message forwarding

**Q: NapCat 掉线？/ NapCat disconnected?**
- NapCat 使用 NTQQ 协议，长时间挂机可能需要重新登录 / NapCat may need re-login after long periods
- 建议使用 Docker restart policy: `--restart unless-stopped`

## 其他 OneBot 实现 / Other OneBot Implementations

除了 NapCat，以下 OneBot v11 实现也应该兼容 / Besides NapCat, these should also work:

- [LLOneBot](https://github.com/LLOneBot/LLOneBot) — NTQQ 插件 / NTQQ plugin
- [Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core) — 跨平台 / Cross-platform
- [OpenShamrock](https://github.com/whitechi73/OpenShamrock) — Xposed 模块 / Xposed module (Android)

只要支持正向 WebSocket 的 OneBot v11 实现都可以使用。
Any OneBot v11 implementation with Forward WebSocket support should work.
