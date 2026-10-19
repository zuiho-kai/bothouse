# 板子接 Discord：给别人用的配置说明

板子当 Discord 里某个 bot 的「躯体」：对板子叫她的名字，这句话发进 Discord 给她；她回你的话，板子念一段摘要。频道里的文字照旧是全文。

```
板子 ──语音转文字──▶ 主机 ──选频道（小模型）──▶ webhook「板子」发进频道，@ 被叫到的 bot
bot 回复 ──POST /rh/discord/hook──▶ 主机 ──摘要（小模型）──▶ 板子念
```

## 前提
- 一个 Discord 服务器。
- 一个 bot，在服务器里有「管理 Webhook」和「管理频道」权限（主机用它的 token 列频道、建频道、给频道建 webhook）。
- 你的 bot 程序要接收 webhook 发的消息。webhook 消息的作者是 bot 身份，很多框架默认会丢掉。只放行主机建的那几个 webhook ID。

## 最少配置
`roles.example.toml` 是空白模板。复制成 `roles.toml`，最少填这几项：
- `[discord] relay = true`、`channel = "<默认频道 ID>"`、`play = true`（真板出声）。
- 至少一条 `[[discord.bots]]`：`bot_id`、`role`（哪个角色的音色和板子）、`project`（回调里怎么认她）。
- 下面两样有一样就行：`.env` 里放默认频道的 webhook 地址（`RH_DISCORD_WEBHOOK`），或者放 bot token（`DISCORD_BOT_TOKEN`），由主机自己建 webhook。

只填这些时的行为：所有话都进默认频道，板子念回复的全文，不建频道。模板里 `guild`、`[discord.router]`、`[discord.summary]` 都是注释掉的，不打开就不会去列频道、不会调模型。

## 可选项（都在 `[discord]`，模板里每项有注释）
- `guild` 加 `[discord.router]`：用小模型按意思选频道。候选是 A「原地（默认频道）」、B「新建频道」，加上服务器里的文字频道（名字和说明）。
  - `[discord.router] exclude_channels = ["<频道 ID>", ...]`：不当候选的频道，例如机器日志频道。
  - 被叫到的 bot 看不到或不能发言的频道自动不当候选（主机按服务器身份组和频道权限算）。
- `create_channels = true`：选到「新建」时真的建一个文字频道，名字从这句话里取，这句话发进新频道。下一句照常重新选频道。建之前先重新列一次频道，已有同名频道就直接用；同一时刻只建一个。
- `[discord.summary]` 和 `chars`：朗读摘要。没配就念全文；配了但失败、超时只念第一句。
- `[discord]` 段写了不认识的键，主机启动时报错。
- 两个模型都填 OpenAI 兼容的 `/chat/completions` 地址加模型名。本机小模型、便宜的 API 都行。key 用 `key_env`（环境变量名）或 `key_file`（文件路径）配置，不在配置里写值。
- 本机实测（只记在这里）：2026-10-19，LM Studio 上的 Qwen3.5-4B（要配 `prefill`），用我们服务器的真实频道列表（去掉量化日志），14 句口语全部选对，选一次频道 0.08–0.24 秒（两轮实测合起来）；一段摘要 0.23–0.30 秒，模型冷启动 6.3 秒。

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

## 不进 git 的文件
`.env`、`data/discord-webhooks.json`（里面有 webhook 地址和 token，权限 0600）、`data/discord-allow-bots.txt`。
