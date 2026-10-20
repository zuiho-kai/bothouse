# 线 2：接进 Discord 或飞书

**用安装向导，几分钟配完。** 向导在 cc-connect 自带的网页里，人点界面；AI 用一条命令或一个 HTTP 接口，参数一次给全。
两条路写的是同一份配置。命令行手动配的老办法放在文末附录。ccm 和 gate 怎么起见[线 1](ccm-and-wiki.md)。

```
 选平台 ─▶ 接机器人 ─▶ 每个角色选本机 CLI ─▶ 人设 ─▶ 兜底角色 ─▶ jev ─▶ 保存，重启生效
 Discord：选已有机器人或填 token，选服务器、默认频道        （可选：挂第三方 API）
 飞书：扫码，选默认群
```

## 1. 打开向导

```sh
cd conest/bridge && make build      # 带网页的完整版（要 node）
./cc-connect                        # 第一次运行：建好配置，只起向导（只听本机 127.0.0.1）
# 带 token 的登录链接写在配置旁边的 setup-link.txt（只有你能读），打开它就是向导；终端里不打印 token
```

已经在跑的 cc-connect：网页「项目」页右上角「添加项目」就是向导。

## 2. 向导每一步

除了下面这几项，其余全部用默认值，向导里不出现。

1. **平台**：Discord 或飞书。一主多 sub、gate、角色之间交接都在 Discord 上做全；飞书这一轮只接一个机器人（缺什么见附录 B）。
2. **机器人**
   - Discord：先列出本机配置里已有的机器人，点一下直接用（沿用它原来的 project 名、work_dir 和人设，人设只有你勾了「改」才会写）；没有就按提示去[开发者后台](https://discord.com/developers/applications)
     建应用 → Bot → Reset Token，打开 **Message Content Intent**，把 token 填进来。向导校验 token（没开 intent 会提醒），
     列出机器人所在的服务器让你选，再列出频道选默认聊天频道。机器人还没进这个服务器时给邀请链接。
     一个机器人 = 一个角色，「再加一个机器人」加下一个。
   - 飞书：扫码，自动建应用；扫完列出机器人所在的群，选默认聊天群（还没进群就先跳过，私聊照样能用）。
3. **本机 CLI**：只列出这台机器上装了的（claude、codex、gemini、opencode 等），带版本和登录状态。默认用 CLI 自己的本地登录。
   想用第三方 API，勾「改用第三方 API」，选服务商、填 key（下面「第三方 API × 本机 CLI」）。
   「复制提示词」会生成一段话，交给本地 CLI 让它自己配。
4. **人设**：点一个默认人设（橘、鲸鱼娘、龙娘、彩虹猫、渡鸦）填进去再改，或者自己写。默认人设按网页语言给中文或英文版。
   「回答语言」默认等于网页语言，可改，写进人设文件，机器人按它回答。
   装完以后改人设有三种办法，改的是同一个文件（`<work_dir>/CLAUDE.md`、`AGENTS.md`、`GEMINI.md`……，按 CLI 定）：
   网页「项目」→ 角色 →「人设」；在聊天里叫机器人改；直接改文件夹里的文件。
5. **兜底角色**：从这次配好的机器人里选一个，默认第一个。jev 没填、测试没过、或判断不出该谁回时，由它接话。
6. **jev**：三个框（Base URL、Key、模型），填一个能返回概率的模型。填完自动测一次（和 gate 一样问一道 A/B/C 选择题，看前 20 个候选里有没有选项字母），测的时候不写盘；
   能用就点下一步存下。不给概率或连不上就不存，换一个或跳过 jev（跳过会删掉原来的 jev.json，等于不填）。
   已经有能用的 jev 时框里预先填好，原样点下一步就是继续用它；新填的没通过时提示「仍在用旧的 …」，旧的不动。见下面「jev 和兜底角色」。
7. **保存**：写进本机配置，点「重启生效」。

## 3. 让你的 AI 帮你配

把下面这段和你的 token、key 一起交给 Claude Code / Codex 等本地 CLI：

> 帮我用 cc-connect 的安装向导接口配好 Discord 机器人。先运行 `cc-connect setup clis` 看本机有哪些 CLI，
> `cc-connect setup matrix` 看第三方 API 挂到哪个 CLI 是原生还是转换，`cc-connect setup personas` 看默认人设。
> 然后按下面的格式写一个 JSON，先 `cc-connect setup apply --json <文件> --dry-run` 检查，没问题再去掉 `--dry-run` 跑一次。
> token 和 key 不要打印、不要写进日志。做完把输出 JSON 里的 `steps` 和 `jev_hint` 告诉我。

```json
{
  "platform": "discord",
  "language": "zh",
  "discord": {"guild_id": "<服务器 ID>", "channel_id": "<默认频道 ID>"},
  "roles": [
    {"token": "<机器人 1 的 token>", "agent_type": "claudecode", "persona": "# 角色：……", "reply_language": "zh"},
    {"reuse_project": "<本机配置里已有的 project 名>",
     "provider": {"vendor": "deepseek", "api_key": "<key>"}}
  ],
  "fallback_role": "<兜底角色的 project 名，不写 = 第一个>",
  "jev": {"base_url": "https://api.siliconflow.cn/v1", "api_key": "<key>", "model": "<模型>"}
}
```

- `reuse_project` 的机器人保留原 project 名、CLI、work_dir、服务器；只有这一项带了 `persona` 才会改它的人设文件。
  新机器人的名字和配置里已有的项目撞了：是同一个机器人（bot ID 一样）就更新那个项目，不是就加 -2、-3。
  兜底角色可以用 `fallback_bot_id`（机器人 ID）指定，网页就这样传。
  CLI 在 PATH 之外（如 `~/.local/bin`）找到时，把绝对路径写进该项目的 `cmd`，重启后也找得到。
  多个机器人组队时，已有的 `allow_bots` 取并集，自己改过的 `gate_url`、`gate_fallback`、`team_lead_bot`、`group_reply_all` 不动。
- 第三方 API：`custom` 必须给 `base_url`；硅基流动、OpenRouter、本机模型、custom 必须给 `model`。
- 每项都能省：`agent_type` 不写 = 本机第一个已登录的 CLI；project 名不写 = 机器人名；`work_dir` 不写 = `~/.cc-connect/roles/<project>`。
- 同样的 JSON 也能 `POST http://localhost:<管理端口>/api/v1/setup/apply`（`Authorization: Bearer <management token>`），返回同一份 JSON。
- 飞书：`"platform": "feishu"`，加 `"feishu": {"app_id", "app_secret", "chat_id"}`（app_id/secret 来自扫码或 `cc-connect feishu setup`），`roles` 只放一个。
- 网页向导最后一步「给 AI」里有当前这套配置的命令，密钥是占位符。
- 返回里 `jev_ok` 为 false 时 jev 没有写入，`jev_reason` 说明原因（不给概率 / 连不上 / 接口拒绝了测试请求，例如 mlx_lm.server 最多给 11 个候选、gate 要 20 个）。复用的机器人 token 写成 `"${环境变量}"` 时，向导用当前进程的环境变量去校验，配置里仍保留占位符；变量没设会直接报出变量名。

## 4. 第三方 API × 本机 CLI

`cc-connect setup matrix` 的结果（2026-10-20）。「原生」= 这家有给这个 CLI 用的接口，直接连；「转换」= cc-connect 在本机
起一个转换口，把 CLI 的协议（Claude 的 Messages、Codex 的 Responses、Gemini 的 generateContent）转成 `/chat/completions`，
key 只留在 cc-connect 里。所以任何 OpenAI 兼容接口都能挂到这四个 CLI 上。

| 服务商 | Claude Code | Codex | Gemini CLI | OpenCode |
|---|---|---|---|---|
| 硅基流动 | 原生 | 转换 | 转换 | 原生 |
| OpenRouter | 原生 | 原生 | 转换 | 原生 |
| DeepSeek | 原生 | 原生 | 转换 | 原生 |
| MiniMax（中国站 / 国际站） | 原生 | 原生 | 转换 | 原生 |
| 本机模型（Ollama、LM Studio、llama.cpp…） | 转换 | 转换 | 转换 | 原生 |
| 其他 OpenAI 兼容接口（自填 Base URL） | 转换 | 转换 | 转换 | 原生 |

接口地址的来源在 `bridge/core/setup_detect.go` 的 `WizardVendors`。别的 CLI（Cursor、Copilot、Kimi、Qoder…）cc-connect 里不能挂第三方 API，
只能用它们自己的登录；WorkBuddy 装了会显示，但 cc-connect 还没有它的适配器，不能选。

## 5. jev 和兜底角色

- **jev 用来判断群里一句话该哪个角色回**：gate 每条消息先走规则（@ 了谁、开头叫了谁），规则判不了再让 jev 读几个选项的概率。
  接了板子的话，对板子说话时也用它选进哪个 Discord 频道（附录 C）。
- 推荐：硅基流动（如免费 Qwen 小模型）、OpenRouter、DeepSeek、MiniMax、本地小模型（如 Qwen 0.6B）。
  不推荐 Claude、GPT：它们的接口不给概率。jev 也不能复用 Claude Code / Codex 的本地登录，同样是因为拿不到概率。
  WorkBuddy 是助手产品，不是模型服务，所以不在这里，装了会在第 3 步出现。
- 测法和 gate 一致：一个字的请求，要前 20 个候选的概率，A/B/C 至少一个在里面才算能用（`contrib/gate/scorer_remote.py` 同一条件）。
  请求里带 `chat_template_kwargs: {"enable_thinking": false}`（Qwen3 一类模型默认先出 `<think>`）；服务在 400 里说明 top_logprobs 上限（如 mlx_lm.server 最多 11）或不认这个字段时自动调整重试，找到的参数存进 `jev.json`，gate 照用。回一个字超过 2.5 秒（gate 的等待上限）判为太慢。
  实测（2026-10-20）：mlx_lm.server + Qwen3-0.6B-4bit 能通过并能打分；LM Studio（MLX 引擎）回 `logprobs: null`，当不了 jev。
  能用才写 `jev.json`；不能用就不写，原来能用的旧 jev 保留并在原因里写「仍在用旧的 …」——新填错一次不该悄悄把选角色关掉。
  一键命令和接口同样：`jev` 不给 = 不动；`"jev": {"base_url": ""}` = 删掉；没存时返回 `"jev_ok": false`、`jev_reason`，`jev_in_use` 是现在生效的那个。
- **没有可用的 jev**（没填、测试没过）：gate 改用本机 mlx 的 Qwen（只有 Apple 芯片 Mac）；也没有就只按规则判，
  被 @、被点名的角色照常回，规则判不了的由兜底角色回。**gate 没在运行**时：被 @ 的角色照常回，其他消息由兜底角色回
  （cc-connect 的 `gate_fallback`：兜底角色 `reply`，其他 `context`；被 @ 时一律 `reply`，见 `bridge/core/gate.go`）。
  接了板子时，选频道退到按频道名和读音匹配。

## 6. 向导写了什么（给别的程序读）

都在 cc-connect 的数据目录（默认 `~/.cc-connect`）：

| 文件 | 内容 | 谁读 |
|---|---|---|
| `config.toml`（写之前把原文件备份成 `config.toml.bak-<时间>`，每次一份、不覆盖：重写会丢注释，注释从备份里找回；所有写配置的路径共用一把文件锁，向导和正在跑的服务不会互相覆盖） | 每个机器人一个 `[[projects]]`：token、`guild_id`、CLI、第三方 API（`api_format = "openai_chat"` 表示走本机转换）；多个 Discord 机器人时还有 `group_reply_all`、`share_session_in_channel`、`allow_bots`、`team_lead_bot`、`gate_url`、`gate_fallback` | cc-connect |
| `roles/<project>/CLAUDE.md` 等 | 人设 + 回答语言（`<!-- conest:reply-language -->` 之后那行） | 对应的 CLI |
| `jev.json`（权限 600） | `{"backend": "llm", "url", "model", "api_key", "logprobs", "tested_at"}` | gate（`contrib/gate/scorer_remote.py`）；角色小家 `[discord.router] key_file` |
| `gate-team.json` | `{"lead": 兜底角色, "subs": 其他角色}`，key 是 project 名 = `gate_url` 的 `?bot=` | gate |
| `conest-setup.json` | 平台、服务器 ID、默认频道 ID / 飞书默认群、兜底角色、团队（不含密钥） | 向导下次打开时；角色小家要默认频道时照抄 `channel_id` |

## 附录 A：手动接 Discord

### A1. 每个 bot 建一个应用

详细截图步骤见 [bridge/docs/discord.md](../bridge/docs/discord.md)。要点：

1. [Discord 开发者后台](https://discord.com/developers/applications) → New Application → Bot → Reset Token，复制 token。
   一个角色一个应用、一个 token。
2. Bot 页打开 **Message Content Intent**（不开读不到消息正文）。
3. OAuth2 → URL Generator：scopes 勾 `bot`、`applications.commands`；权限至少勾查看频道、发消息、读消息历史、加反应。
   要接板子并让主机自己建频道和 webhook 的那个 bot，再勾「管理 Webhook」「管理频道」。用生成的链接把 bot 拉进你的服务器。
4. token 写进 `~/.cc-connect/config.toml` 对应 project 的 `[projects.platforms.options] token`，不进任何仓库。

### A2. 拿 ID

Discord 设置 → 高级 → 打开**开发者模式**。之后右键就能「复制 ID」：

- 你自己的用户 ID → `allow_from`（只听你的话）。
- 每个 bot 的用户 ID → 别的 bot 的 `allow_bots`、所有 bot 的 `team_lead_bot`（填主 bot 的）。
- 服务器 ID、频道 ID → 角色小家的 `roles.toml`（下面「默认发言频道」）。

### A3. 一主多 sub 的选项

都在每个 bot 的 `[projects.platforms.options]`，完整例子见线 1 第 2 步：

- `group_reply_all = true`：群里不 @ 也听，交给 gate 判断回不回。
- `share_session_in_channel = true`：一个频道一份会话。
- `allow_bots`：队友 bot 的 ID。队友 @ 我才开一轮，没 @ 只当上下文；不列的 bot 的消息全忽略。
- `team_lead_bot`：主 bot 的 ID。两个 sub 互相 @ 超过 3 轮，交给主 bot。

### A4. 怎么验证

- 群里说一句闲聊，主 bot 按 gate 的判断回或不回；`~/.cc-connect/gate.jsonl` 里有这句的判断。
- 「码农，帮我看下 X」→ 只有码农回；主 bot @ 码农派活 → 码农接，做完 @ 回来。

## 附录 B：飞书命令行

### 1. 扫码接入一个 bot

```sh
cd conest/bridge
./cc-connect feishu setup --project <你的 project 名>
```

终端里出二维码，用飞书手机 App 扫码，会自动建企业自建应用、开机器人能力、配权限和事件订阅，并把 App ID、App Secret
写回配置。不想扫码、已有应用时：`./cc-connect feishu setup --project <名> --app cli_xxx:sec_xxx`。
手动建应用的完整步骤见 [bridge/docs/feishu.md](../bridge/docs/feishu.md)。飞书用长连接，不需要公网 IP。

### 2. 飞书上目前没有的

这些只在 Discord 上实现了，飞书上一个 bot 照常对话，但：

- gate 拿不到「这句 @ 了谁」（`mentioned` 只有 Discord 填），只能靠消息里叫的名字判断。
- 没有 `allow_bots`、`team_lead_bot`：bot 之间不会互相接话、交接，也没有 sub 互 @ 超过 3 轮交给主 bot 的保护。
  所以飞书上先只放一个 bot，不要把一主多 sub 原样搬过去。
- 角色小家的板子只接 Discord（板子的话发进 Discord 频道、念 Discord 里的回复）。

### 3. 怎么验证

私聊或在群里 @ 这个 bot 说一句，它回话；ccm 日志里有这条消息。

## 附录 C：默认发言频道和自动选频道（角色小家，接板子时才用）

这一节说的是：你对着板子说话，这句话发进 Discord 的哪个频道。全部在 `role-household/roles.toml` 的 `[discord]` 段配，
模板是 `role-household/roles.example.toml`（每项有注释），逐项说明见 `role-household/docs/DISCORD_BODY.md`。
`roles.toml` 是你自己的本地文件，不进 git；密钥写进 `role-household/.env`（模板 `.env.example`）。

| 想要的 | 配置项 | 默认 |
|---|---|---|
| 默认发言频道 | `channel = "<频道 ID>"` | relay 开着必填 |
| 自动选频道开关 | `auto_channel = true / false` | 默认不写；不写时，配了模型（`url` 或向导的 `key_file`）或 `guild` 就开，都没配模型时按频道名和读音匹配 |
| 选频道用什么判断 | `[discord.router] backend = "llm"` 或 `"jev"`，加 `url`、`model` | 不写 url = 按频道名读音匹配 |
| 用向导填的 jev | `[discord.router] key_file = "~/.cc-connect/jev.json"`（只写这一行，url/model 从文件取） | 向导测出不给概率 → 读音匹配 |
| 频道别名 | `[discord.router] aliases = {"<频道 ID>" = ["量化"]}` | 只认频道名 |
| 新建频道 | `create_channels = true` | `false` |
| 朗读摘要 | `[discord.summary]` | 念全文 |

三种判断：

1. **不配模型：完全匹配，允许口音。** 这句话里出现了频道名或别名就进那个频道，按读音比（同音字、声调、前后鼻音、n/l 不分，
   同语音唤醒词）。匹配不上、同时像两个频道 → 默认频道。
2. **`backend = "llm"`**：任何 OpenAI 兼容接口（本机 LM Studio、便宜的 API），`url` 写 base 地址（如 `http://127.0.0.1:1234/v1`），
   不要带 `/chat/completions`。
3. **`backend = "jev"`**：jev 的 System One 接口（真 jev 是 TypeSafe 托管：`url = "https://api.typesafe.ai"`、`model = "jev-latest"`）。
   没有 jev 账号可以跑 `role-household/tools/jev_local.py`：它用本机 Qwen 读选项 logits 冒充同一个接口，**不是 jev 本身**，
   打分复用 gate 的 `bridge/contrib/gate/scorer.py`。

模型出错、超时、答非选项时退回第 1 种。主机启动时在后台先调一次模型预热，免得开机第一句等模型冷启动超时。
开了 relay 时，主机启动先自检 bot token、默认频道、webhook 是不是这个频道的，配错直接报错并说改哪一项。

> 上面 `auto_channel`、`jev`、读音匹配、启动自检这几项在角色小家本地版本里，按每天的例行同步进 `role-household/`；
> 同步之前，conest 里的 `role-household/` 只有 `llm` 一种判断，没配就只进默认频道。

**和 conest 里这份 bridge 的差别**：`role-household/docs/DISCORD_BODY.md` 写的 `allow_bots_file`（主机建的 webhook ID 自动放行）
和 `message.sent` 钩子里的 `extra.trigger_message_ids`（按消息 ID 对账）在 [zuiho-kai/cc-connect](https://github.com/zuiho-kai/cc-connect)
maomao 分支上，conest 的 `bridge/` 快照还没有。用 conest 的 bridge 时：主机建的 webhook ID（主机日志「建了 webhook <ID>」）
要手动加进对应 bot 的 `allow_bots`；回复按频道对账（主机替你问过之后 30 分钟内，她在同一频道的第一条才念）。
