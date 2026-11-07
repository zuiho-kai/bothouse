# QQ 平台接入指南 / QQ Platform Setup Guide

## 可选群聊行为 / Optional group behavior

在已有 QQ 项目的平台选项中按需添加；以下号码均为示例，请替换为自己的配置。

~~~toml
[projects.platforms.options]
ws_url = "ws://127.0.0.1:3001"
allow_from = "12345"
allow_groups_with = "12345"       # Optional: accept others in groups containing this user
split_bubbles = false            # Opt in to one message per blank-line-separated paragraph
save_images_dir = "/path/to/received-images" # Optional; omit to avoid writing images
share_session_in_channel = false
allow_qzone = false              # Optional: read/post/delete this account's own 说说 (NapCat extension)
allow_avatar = false             # Optional: change this account's own avatar (NapCat set_qq_avatar)
~~~

- **群授权**：未设置 allow_groups_with 时维持 allow_from。设置后，群成员查询确认指定用户在群里才放行其他人的消息；成员查询失败不会放行。成员状态缓存 10 分钟，指定用户退出群后权限变化可能延迟到缓存到期。私聊仍只按 allow_from。注意：这也允许群内其他成员使用普通命令（如 /stop、/new）；只应在可信群启用，管理员命令仍由原有管理员检查控制。
- **拆条**：split_bubbles 默认关闭；开启后按空行顺序发送，含代码围栏的回复保持一条。中途失败会停止后续发送，已发送的消息不会撤回。显式 ReplyWithAt 发送入口保持单条消息。
- **图片**：设置 save_images_dir 才落盘，保存收到的原始字节（包括 GIF 动画）；交给模型的超大图片预览会缩小；超出 2 MiB 且无法解码（如未支持的 WebP）或缩小后仍超限时，省略预览并附文字提示，已保存的原件不变。此目录由使用者管理，当前不会自动清理。
- **群前文与引用**：每群保留最近 10 条、15 分钟内的聊天作为当前轮背景；当前发言、引用和合并转发分别标注发送者。静默缓冲及排队合批不重复存入旧背景；命令、权限与判断服务使用本条原始文字。图片保存路径只出现在当前轮附加上下文，不进入群前文。群前文会向同群会话提供近期消息，敏感会话请勿共用群聊。
- **合并转发**：以素材块展开文本及图片，限制文本长度；转发中的发言人不替代当前发送者，文本标明其中的要求不是当前指令。这是模型上下文提示，不是执行权限隔离。
- **静默尾段**：工具调用后的 NO_REPLY 标记不作为文字气泡发送。
- **说说与头像**：`allow_qzone = true` 才允许查/发/删/换这个号自己的说说，`allow_avatar = true` 才允许换这个号的头像，两个默认都关。它们走 NapCat 的空间扩展（`get_qzone_msg_list` / `send_qzone_msg` / `delete_qzone_msg`）和账号接口 `set_qq_avatar`，不在 OneBot 11 规范里；上游没有这些 action 时会如实说"这个 OneBot 实现没有这个扩展接口"，不会只扔一个 retcode。面板上在「项目 → 说说」一页，发之前、换说说之前和换头像之前各问一次；不自动发，也没有定时。**换说说**（`social/moment/replace`）是一次动作：NapCat 没有改正文的接口，所以实现是「先发新的、成功了才删旧的」，不是原子替换——发失败旧的原样保留；新的发了旧没删掉、或者上游没给新 tid 时，如实报「现在有两条（或可能有两条）」并把新那条带回去。旧说说带的图由平台读回来随新的一条一起发，读不回旧说说就一个请求都不发、原文不动。旧说说要是「仅部分人可见」，也**不给换**：上游只给一个布尔，分不出好友可见/部分好友/仅自己/部分不可见，而发说说缺省是所有人可见，换了等于把它变公开、删了旧的还回不去，所以直接拒绝（400）、原样不动。评论、点赞、发布时间、tid 也都带不过去——换说说本质是发新的删旧的。

排队回执属于项目配置，在对应的 [[projects]] 表内设置 queued_notice = false 可静默排队；不改变排队顺序，省略时仍显示回执。不要把该字段放进 platforms.options。

English: replacing one 说说 is a single action too — NapCat exposes no text-edit call, so it publishes the new post first and deletes the old one only after that succeeds. It is not an atomic swap: a failed publish keeps the old post, and a failed delete (or a missing new tid) says both posts now exist — or likely do — and returns the new one instead of pretending the edit was in place. Pictures on the old post are read back and carried over; if the old post cannot be read back, nothing is published and the original stays. A post marked "visible to some people only" is refused (400) and left alone: upstream reports only a boolean, so friend-only, some-friends, private and hidden-from-some cannot be told apart, and a new post defaults to everyone; comments, likes and the publish time do not carry over either. Group allow-list extension, paragraph splitting and original-image storage are optional. Splitting defaults off. Group membership is cached for ten minutes; DMs keep their original allow-list. Recent group context and forwarded material retain speaker labels. The project-level queued_notice option only hides the receipt, not the queue. Posting 说说 and changing the account avatar are also optional and off by default (`allow_qzone` / `allow_avatar`); both use NapCat extensions rather than standard OneBot 11 actions, live on the project's 「说说」 panel tab, ask once before each write, and never post on a schedule.

## 可选判断模型 / Optional judging model

无需模型也可使用原有的点名回复方式。已有多角色团队分发可继续使用 [gate / jev](../../docs/ccm-and-wiki.md)。若只需判断 QQ 群消息是否接话，可使用独立的 [QQ gate](../contrib/qq-gate/README.md)：默认关闭判断，支持自部署 OpenAI 兼容服务、远程 API，以及自定义 HTTP 判断服务，不要求返回 token 概率。

服务和桥接分开运行；先复制其中的脱敏示例，再按 README 设置 QQ_GATE_CONFIG。在对应 [[projects]] 中启用：

~~~toml
gate_url = "http://127.0.0.1:13013/decide"
gate_timeout_ms = 3000
gate_fallback = "silent"
~~~

API 密钥通过配置指定的环境变量读取，不写入示例。判断超时、连接失败或输出不明确时不主动接话；明确 @ 的消息仍可回答。停止使用时移除该项目 gate_url，恢复桥接自身的路由方式。先在隔离配置与测试群验证，不能把模拟测试视为真实账号验收。

English: the optional QQ gate supports self-hosted or remote APIs without logprobs. It is a separate service and defaults to addressed-only replies. Errors stay quiet; explicit mentions remain answerable. Remove gate_url to return to the bridge's built-in routing.

## 图片工具与恢复 / Image tools and recovery

生成图片的服务由使用者选择，本适配器不附带角色立绘、私人提示词或固定的生图服务。服务生成本地图片后，复用已有发送入口（仅在用户授权的会话执行）：

~~~sh
bothouse send --project YOUR_PROJECT --session 'qq:g:GROUP_ID' --image /path/to/generated.png
~~~

该命令发送已有文件，不负责生图。若要让 bothouse 自己画，可选用 `[image_gen]`（OpenAI 兼容 `/images/generations`，默认关闭）：面板「生图」页或 `POST /api/v1/image-gen` 把图写成本地文件，仍然按上面这行发送，不会自动发到群里。只有发送回执成功才可记为已发送；响应丢失时先核对实际消息，不要自动重复发送。生成过程与发送过程应分别记录，API 密钥、生成素材和输出文件放在仓库之外。

恢复时先区分 QQ 登录状态、OneBot 连接、桥进程、模型会话四层。保留正在使用的配置、二进制版本与运行数据备份；恢复相同配置和数据目录后再核对连接日志及会话。桥已有轮次 journal 与恢复机制，本变更不引入另一套重启脚本或调度器。不能只凭模型会话是否存在判断 QQ 离线期间是否收到消息；应分别查 OneBot 接收记录与桥接处理记录。更换版本必须由用户授权，回退使用已备份的版本与配置，不清空运行数据。

English: image generation stays with a user-selected service (optionally bothouse's own opt-in [image_gen] client, off by default); send its output with the existing --image CLI. Recovery should distinguish QQ login, OneBot transport, the bridge process and the model session. Keep versioned backups and inspect receipts before retrying external sends; this change adds no production restart mechanism.

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

**`command_allow_from` 配置说明 / `command_allow_from` options:**
- 未设置、`""` 或 `"*"` — 保持原行为：`allow_from` 放行的人都能发斜杠命令 / Unset, `""` or `"*"`: prior behavior, anyone admitted by `allow_from` may send commands
- `"12345"` — 只有 QQ 号 12345 能用 `/` 开头的命令触发机器人；其他发送者的命令在进入引擎前就被丢掉，不回复 / Only QQ user 12345 may trigger the bot with a slash-prefixed command; other senders' commands are dropped before the engine and get no reply

命令包括内置命令、自定义命令、技能，以及未知命令（原本会转发给 agent）。普通聊天不受影响，仍只看 `allow_from`。这个设置只决定谁能发命令，不授予特权命令权限（`admin_from`）。

Commands include built-ins, custom commands, skills and unknown commands (which core would otherwise forward to the agent). Ordinary chat is unaffected and still follows `allow_from`. This setting decides who may send commands only; it grants no privileged command access (`admin_from`).

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
| 引用回复 / Quote reply | ✅（保留作者和原文；缓存缺失时调用 `get_msg`） | ✅（`bothouse send --reply-to`，QQ 原生引用） |

`http_url` 是 NapCat 的 HTTP API 地址（如 `http://127.0.0.1:3000`），配了之后收文件会走 `get_group_file_url` / `get_file` 拿新链接，发文件走 HTTP，避免 WebSocket 大包和跨容器路径问题。

`http_url` is NapCat's HTTP API endpoint (e.g. `http://127.0.0.1:3000`). With it set, receiving a file re-resolves an expiring CDN link via `get_group_file_url` / `get_file`, and sending a file goes over HTTP instead of the WebSocket, avoiding large frames and cross-container path issues.

### 消息上报格式 / Message report format

NapCat 的 OneBot 配置支持 `"messagePostFormat": "array"` 和 `"string"`，bothouse 现在用同一套消息段处理逻辑接收两种格式的文字、图片、文件、语音、@ 和引用。图片与语音仍需要可下载的 `url`；文件沿用上面的 URL / HTTP API 下载流程；语音转写仍需配置 STT，格式转换能力没有变化。

Both `"messagePostFormat": "array"` and `"string"` are supported. Text, images, files, voice, mentions and quotes use the same segment-processing path. Images and voice still need a downloadable `url`; files use the URL / HTTP API flow above. Voice transcription still requires STT; audio conversion support is unchanged.

引用上下文先查本次运行的消息缓存（最多 1000 条 / 7 天），未命中时通过 OneBot `get_msg` 获取原文，所以桥重启前的消息也能补取（前提是 OneBot 仍可读取该消息）。保留原作者和引用关系；引用机器人的旧消息，即使没有另附文字，也算叫到机器人。原消息被撤回、不可读或获取失败时，明确标记「无法获取原文」，不编造正文。旧图片、语音等只显示类型标记，不重新下载附件。

Quote context uses the process cache first (up to 1,000 entries / seven days), then OneBot `get_msg`. Older messages survive a bridge restart if OneBot can still retrieve them. Author and quote relation are retained; quoting an older bot message also calls the bot. An unavailable original is explicitly marked as unavailable. Old media is described without downloading it again.

### 主动引用回复 / Send a native quoted reply

QQ 消息送入代理时，公共桥接层提供当前消息 ID、被引用的原消息 ID 和命令用法；DSH / ACP 与其他 CLI 使用同一入口，无需模型专属设置。代理可选择同一会话里已知的消息：

~~~sh
bothouse send --reply-to MESSAGE_ID --message '针对这条消息的回复'
# 显式指定目标时沿用现有项目和会话参数：
bothouse send --project YOUR_PROJECT --session 'qq:g:GROUP_ID' --reply-to MESSAGE_ID --message '回复'
~~~

消息使用 OneBot `reply` 段，支持群聊与私聊，复用已有发送回执及 `--at-users` / `--at-all`。桥接层会核对目标消息属于该会话：缓存已知其他会话、获取结果不符、无法验证归属或平台不支持时均返回错误，不降级成模仿引用的文字。发送成功后不要再重复回复相同正文。`--reply-to` 必须带文字，不能与 `--cwd` / `--dm` 或任务文本投递合用；普通发送无需这个参数。

English: the shared inbound context supplies message IDs and usage to every backend, including DSH / ACP. `send --reply-to` emits a native OneBot reply segment for group or private chats, using the existing receipt and mention path. Only known same-conversation targets are accepted; unverifiable targets and unsupported platforms return an error. Text is required; cwd, DM rerouting and task-text delivery cannot be combined with this flag. Do not repeat the message after a successful send.

本次实现验证覆盖适配器、引擎代理输入与发送 API；真实 QQ 客户端引用框及 Mac / Windows 账号入口须在发布验收中另行记录，不能将模拟回执当作真机验收。

两种格式已通过本地模拟 OneBot WebSocket 与 HTTP 附件测试；尚未作为本次改动的一部分完成真实 QQ / NapCat 验收。CQ 转义遵循 [OneBot v11 字符串格式](https://github.com/botuniverse/onebot-11/blob/master/message/string.md)：先分段再解码，转义后的 CQ 文字不会被当作真实 @ 或附件。

Both formats are covered by local simulated OneBot WebSocket and HTTP attachment tests; live QQ / NapCat acceptance has not been performed for this change. Escapes follow the [OneBot v11 string format](https://github.com/botuniverse/onebot-11/blob/master/message/string.md): splitting precedes decoding, so escaped literal CQ text is not interpreted as a mention or attachment.

### 模型写出纯文本 @ 时 / When the model writes a plain @

模型常常把 `@123456` 当普通文字输出。直接发出去，对方只会看到「@123456」这几个字，不会收到提醒。所以发送前会把纯文本的 `@数字` 转成 `[CQ:at,qq=数字]`（`@all` → `qq=all`），已经是 CQ 码的不动。

Models often emit `@123456` as plain text. Sent as-is, the person just sees the literal characters and gets no notification. Outgoing messages therefore turn a plain `@digits` into `[CQ:at,qq=digits]` (`@all` → `qq=all`), leaving existing CQ codes alone.

两个公开的 OneBot 桥接都做了同一件事，我们是照它们做的：[openclaw-napcat-qq](https://github.com/Gu-Heping/openclaw-napcat-qq) 的 `convertPlainAtToCq`、[qqbot-claude](https://github.com/foggyww/qqbot-claude) 的 `normalizeOutgoingMessage`。两边也都只把它当作「模型没按格式输出」的兜底，而不是主路径。

Two public OneBot bridges do exactly this, and ours follows them: `convertPlainAtToCq` in [openclaw-napcat-qq](https://github.com/Gu-Heping/openclaw-napcat-qq) and `normalizeOutgoingMessage` in [qqbot-claude](https://github.com/foggyww/qqbot-claude). Both treat it as a safety net for a model that ignored the format, not as the main path.

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

**Q: 图片或语音没有传给模型？/ An image or voice message did not reach the model?**
- 检查日志中的 `qq: download image failed` / `qq: download audio failed`。媒体下载只接受 HTTP 200；404、500 或不完整的 206 响应会跳过，不把错误页或残片作为附件。文字和其他成功下载的附件仍会正常处理；不会自动向 QQ 发送失败通知。
- Check those download warnings in the logs. Media downloads require HTTP 200; error pages and partial responses are skipped. Text and other successful attachments are still processed. No failure notification is automatically sent to QQ.

## 其他 OneBot 实现 / Other OneBot Implementations

除了 NapCat，以下 OneBot v11 实现也应该兼容 / Besides NapCat, these should also work:

- [LLOneBot](https://github.com/LLOneBot/LLOneBot) — NTQQ 插件 / NTQQ plugin
- [Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core) — 跨平台 / Cross-platform
- [OpenShamrock](https://github.com/whitechi73/OpenShamrock) — Xposed 模块 / Xposed module (Android)

只要支持正向 WebSocket 的 OneBot v11 实现都可以使用。
Any OneBot v11 implementation with Forward WebSocket support should work.
