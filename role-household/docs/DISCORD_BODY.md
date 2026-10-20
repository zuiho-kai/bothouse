# 板子接 Discord：给别人用的配置说明

板子当 Discord 里某个 bot 的「躯体」：对板子叫她的名字，这句话发进 Discord 给她；她回你的话，板子念一段摘要。频道里的文字照旧是全文。

```
板子 ──语音转文字──▶ 主机 ──选频道（llm / jev / 读音匹配）──▶ webhook「板子」发进频道，@ 被叫到的 bot
bot 回复 ──POST /rh/discord/hook──▶ 主机 ──摘要（小模型）──▶ 板子念
```

## 前提
- 一个 Discord 服务器。
- 一个 bot，在服务器里有「管理 Webhook」和「管理频道」权限（主机用它的 token 列频道、建频道、给频道建 webhook）。
- 你的 bot 程序要接收 webhook 发的消息。webhook 消息的作者是 bot 身份，很多框架默认会丢掉。只放行主机建的那几个 webhook ID。

## 最少配置
`roles.example.toml` 是空白模板，每项都有注释。复制成 `roles.toml`（本地文件，不进 git），`.env.example` 复制成 `.env` 放密钥。最少填这几项：
- `[discord] relay = true`、`channel = "<默认发言频道 ID>"`、`play = true`（真板出声）。
- 至少一条 `[[discord.bots]]`：`bot_id`、`role`（哪个角色的音色和板子）、`project`（回调里怎么认她）。
- 下面两样有一样就行：`.env` 里放默认频道的 webhook 地址（`RH_DISCORD_WEBHOOK`），或者放 bot token（`DISCORD_BOT_TOKEN`），由主机自己建 webhook。

只填这些时的行为：所有话都进默认频道，板子念回复的全文，不建频道。模板里 `guild`、`[discord.router]`、`[discord.summary]` 都是注释掉的，不打开就不会去列频道、不会调模型。

开了 `relay` 时，主机启动先自检（只读，不发消息）：bot token Discord 认不认、默认频道 bot 看不看得到、是不是在 `guild` 这个服务器、`RH_DISCORD_WEBHOOK` 是不是默认频道的 webhook。配错就直接报错退出，并写清改哪一项；连不上 Discord 只警告，照常启动。

## 每一项在哪配（都在 roles.toml 的 `[discord]`，改完重启主机）

| 想要的 | 配置项 | 默认 |
|---|---|---|
| 默认发言频道 | `channel` | 无，relay 开着必填 |
| 自动选频道开关 | `auto_channel` | 不写 = 配了 `guild`（加 bot token）或 `[discord.router]` 的模型就开；`false` = 全进默认频道 |
| 选频道用什么判断 | `[discord.router] backend` + `url` | 不写 url = 读音匹配；写了 url、不写 backend = `llm` |
| 频道别名（读音匹配用） | `[discord.router] aliases` | 无，只认频道名 |
| 不当候选的频道 | `[discord.router] exclude_channels` | 无 |
| 新建频道 | `create_channels` | `false` |
| 朗读摘要 | `[discord.summary]`、`chars` | 不配 = 念全文；`chars` 40 |
| 真板出声 | `play` | `false` |

### 自动选频道的三种判断
自动选频道要有 `guild` 和 bot token（主机要列频道）；两样都有、又没写 `auto_channel = false` 时默认就开，没配模型就是读音匹配。候选是 A「原地（默认频道）」、B「新建频道」，加上服务器里的文字频道（名字和说明）；`exclude_channels` 里的、被叫到的 bot 看不到或不能发言的频道不当候选。

1. **读音匹配**（不配模型时用，也是模型出错时的退路）：这句话里出现了某个频道的名字或 `aliases` 里的别名，就进那个频道。按读音比，允许口音和语音转写错字：同音字算（「亮化」=「量化」），两个字以上不看声调，前后鼻音、n 和 l 不分。规则和语音唤醒词同一套（`rh/wake.py`）。同时像两个频道时取命中字数多的，一样多就不猜，进默认频道。读音匹配不会选到「新建」。
2. **`backend = "llm"`**：`url` 填 OpenAI 兼容接口的 **base 地址**（例如 `http://127.0.0.1:1234/v1`），主机自己拼 `/chat/completions`，不要把 `/chat/completions` 写进去。模型只答一个字母。新建频道时也用它从这句话里取频道名。
3. **`backend = "jev"`**：jev 的 System One 接口。`url` 填服务地址，主机拼 `endpoint`（默认 `/v1/systemone`），发一道 choice 题，选项是 A、B、C……。请求格式照 openJiuwen agent-core 的 `JevSystemOneClient`。真 jev 是 TypeSafe 托管的（`url = "https://api.typesafe.ai"`，`model = "jev-latest"`，key 放 `.env`，`key_env` 指过去）。jev 只做选择，不生成文字：新建频道的名字按「专门做 X」取 X，取不到叫「板子新频道」。
   - 没有 jev 账号：`tools/jev_local.py` 用本机 Qwen 读选项 logits 冒充同一个接口。**它不是 jev**，只是一种实现，只答 choice 题，只能在 Apple 芯片的 Mac 上跑。打分直接复用 cc-connect maomao 分支 gate 的 `scorer.py`（conest 仓库 `bridge/contrib/gate/scorer.py`）：
     ```sh
     uv run tools/jev_local.py --scorer /path/to/bridge/contrib/gate/scorer.py   # 听 127.0.0.1:9931
     ```
     然后 `[discord.router] backend = "jev"`、`url = "http://127.0.0.1:9931"`、`model` 随便填。

用 cc-connect 安装向导配的模型：`[discord.router]` 只写一行 `key_file = "~/.cc-connect/jev.json"`，地址、模型名、key、问法（`top_logprobs`、`no_thinking`：只要 1 个 token、按选项字母的概率选，关掉思考）都从这个文件取，backend 也以文件为准；向导测出不给概率的模型不用。roles.toml 另写了 `url` 且和文件里的不一样时拒绝启动，免得把向导的 key 发到别的地址。

llm、jev 出错、超时（`timeout`，默认 2 秒）或答的不是选项，这句退到读音匹配，再不行进默认频道。主机启动时在后台先调一次模型预热：本机模型冷启动 6.3 秒，比选频道超时长，不预热的话开机后第一句必然超时。预热要真的答出选项才算好；成功、失败都记一行 `[discord]` 日志。

### 其他可选项
- `create_channels = true`：选到「新建」时真的建一个文字频道，这句话发进新频道。下一句照常重新选频道。建之前先重新列一次频道，已有同名频道就直接用；同一时刻只建一个。
- `[discord.summary]` 和 `chars`：朗读摘要（OpenAI 兼容接口，`url` 同样填 base 地址）。没配就念全文；配了但失败、超时只念第一句。
- `[discord]` 段写了不认识的键，主机启动时报错。
- key 用 `key_env`（环境变量名）或 `key_file`（文件路径）配置，不在配置里写值。
- 本机实测（只记在这里）：2026-10-19，LM Studio 上的 Qwen3.5-4B（`backend = "llm"`，要配 `prefill`），用我们服务器的真实频道列表（去掉量化日志），14 句口语全部选对，选一次频道 0.08–0.24 秒（两轮实测合起来）；一段摘要 0.23–0.30 秒，模型冷启动 6.3 秒。

## 用 cc-connect（maomao 分支）的人
每个 bot 的 `[projects.platforms.options]` 加一行，指向 roles.toml 里的 `allow_bots_file`（写绝对路径）：

```toml
allow_bots_file = "/path/to/role-household/data/discord-allow-bots.txt"
```

主机每建一个 webhook，先把它的 ID 追加进这个文件，追加成功才用它。主机启动时会把存着的 webhook ID 和这个文件对一遍，缺的补上。cc-connect 发现文件变了会重读，不用重启。全局 `[[hooks]]` 的 `message.sent` 指向 `http://127.0.0.1:<xiaozhi port>/rh/discord/hook`。

maomao 分支的 cc-connect 在 `message.sent` 的 `extra.trigger_message_ids` 里带上触发这一轮回复的 Discord 消息 ID。主机发 webhook 时用 `?wait=true` 拿到自己那条消息的 ID，两边按消息 ID 精确对账：bot 在同一个频道里回别人、交接给队友的话不会被当成回主人的话念出来。

## 不用 cc-connect 的人
你的 bot 每发一条消息，就从本机 POST 一次（只收 127.0.0.1）：

```
POST http://127.0.0.1:8791/rh/discord/hook
{"event": "message.sent", "project": "<[[discord.bots]] 里的 project>",
 "session_key": "discord:<这条消息所在的频道 ID>", "content": "<消息全文>",
 "extra": {"trigger_message_ids": ["<她这条回复是在回哪条消息>"]}}
```

`session_key` 写 `discord:<频道 ID>` 或 `discord:<频道 ID>:<用户 ID>` 都行。

主机只念回主人那句话的消息：
- 带了 `extra.trigger_message_ids`：里面有主机替主人发的那条消息的 ID，才念。推荐带上。
- 没带：退回按频道猜。主机替主人在那个频道问过这个 bot 之后 30 分钟内，她在同一个频道里发的第一条才念。这种方式可能把她回别人的话当成回主人的话。

其他消息只记日志。返回 `{"result": "queued" | "not_waiting" | "other_channel" | ...}`。

## 事件通道：出错、等批准、做完
同一个地址还收三种钩子。`message.sent` 同时算「这一轮做完了」。

| 钩子 | 网页（hub 现有消息列表里一条系统消息） | 表盘 | 板子念 |
|---|---|---|---|
| `error`（读 `error` 字段） | 「橘出错了：<报错开头>」 | interrupted | 「橘那边出错了，详情看网页。」 |
| `permission.requested`（读 `extra.tool_name` 和 `content` 代码块里的操作） | 「橘在等你批准 Bash：<操作开头>」 | thinking | 「橘在等你批准Bash。」 |
| `message.sent` | 「橘这一轮做完了：<回复开头>」 | 清掉这个 project 停住的状态 | 不念 |
| `agent.closed` | 不发 | 清掉这个 project 停住的状态 | 不念 |

- 只认 `[[discord.bots]]` 里有 `project` 的 bot。字段是空或 null 时，冒号和后面那段不写。
- 停住的状态按 project 分开记。一个角色绑了几个 project 时，表盘显示最严重的那个：出错优先于等批准。别的 project 做完不会清掉这个 project 的状态。
- 队友状态文件（`~/im-bridge/team/<project>.json`）里这个角色从忙变闲时，表盘会清：等批准直接清掉；出错只清上一次忙变闲之前记下的（上一轮留下的），不按「看到忙」的时刻算，因为轮询要晚几秒才看到忙。原因是出错本身就会让这一轮结束，如果马上清，红圈只亮一次轮询（约 2 秒）。所以出错的红圈留到下一轮结束、`message.sent` 或 `agent.closed` 时才清。
- 同一个 project 连着来几条 `error`（比如容量重试）时，只念一次、网页只记一条。等到 `message.sent`、`agent.closed` 或这个角色忙变闲之后，再来的出错照常报。

板子念事件的规则和念回复一样：
- `[discord] play` 关着：只进网页、改表盘，不念，也不合成。
- 板子不在线：不念，也不改用 Mac 喇叭。
- 闭麦：只管收音（不听主人说话、不把话发进 Discord）。闭麦期间 Discord 回复和事件照样念。说「闭麦」那一刻正在念的会停下，排队的作废。
- 暂停：只停下正在念的，并作废排队的，不改闭麦开关。之后来的回复和事件照常念。

cc-connect 要在 `~/.cc-connect/config.toml` 的全局 hooks 里加三段，`url` 和 `message.sent` 那段一样。`agent.closed` 原来的 command 钩子（sub wiki）不动，另加一段 http：

```toml
[[hooks]]
event = "error"
type = "http"
url = "http://127.0.0.1:8791/rh/discord/hook"
timeout = 5

[[hooks]]
event = "permission.requested"
type = "http"
url = "http://127.0.0.1:8791/rh/discord/hook"
timeout = 5

[[hooks]]
event = "agent.closed"
type = "http"
url = "http://127.0.0.1:8791/rh/discord/hook"
timeout = 5
```

## 不进 git 的文件
`roles.toml`（模板 `roles.example.toml`）、`.env`（模板 `.env.example`）、`data/discord-webhooks.json`（里面有 webhook 地址和 token，权限 0600）、`data/discord-allow-bots.txt`。
