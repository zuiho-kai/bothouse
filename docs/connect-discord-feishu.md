# 线 2：接进 Discord 或飞书

**用安装向导，几分钟配完。** 向导在 bothouse 自带的网页里，人点界面；AI 用一条命令或一个 HTTP 接口，参数一次给全。
两条路写的是同一份配置。命令行手动配的老办法放在文末附录。还没装 `bothouse` 的先看[从零用起](GETTING_STARTED.md)第 1 步（一行命令，不用 Go 和 Node）。
多个机器人时向导默认开分流（一个主 bot 决定谁回话），bothouse 自动拉起 gate，装好 Python 3.12+ 和 jev 后自动启用智能判断，不用手动起，见下面第 2 节第 5 步。

**多个角色可以全部选同一种 CLI。** 比如三个角色都选本机已经登录的 Codex，各自设置名字和人设，不必安装三份 CLI。Discord 仍需要每个角色一个不同的机器人 token；自建平台按不同角色名区分。DSH 网页的「添加成员」是另一条入口，完整操作和会话/记忆边界见[同模型多成员指南](single-cli-team.md)。

```
 选平台 ─▶ 接机器人 ─▶ 每个角色选本机 CLI ─▶ 人设 ─▶ 分流和主角色 ─▶ jev ─▶ 保存，看还要做什么 ─▶ 重启生效
 Discord：选已有机器人或填 token，选服务器、默认频道        （可选：挂第三方 API）
 飞书：扫码，选默认群
```

## 1. 打开向导

```sh
bothouse          # 第一次运行（还没配机器人）：建好配置，只起向导（只听本机 127.0.0.1），并自动在浏览器打开
```

打不开浏览器（例如远程 SSH）时终端会打印带登录口令的链接，复制到浏览器打开；链接也写在配置旁边的 `setup-link.txt`（只有你能读）。
`bothouse web` 在还没配机器人时也是打开这个向导。已经在跑的 bothouse：网页「项目」页右上角「添加项目」就是向导。

## 2. 向导每一步

除了下面这几项，其余全部用默认值，向导里不出现。

1. **平台**：Discord、飞书或自建平台。一主多 sub、gate、角色之间交接都在 Discord 上做全；飞书这一轮只接一个机器人（缺什么见附录 B）；
   自建平台是自己的聊天网页，打开就能和角色聊，见下面第 7 节。
2. **机器人**
   - Discord：先列出本机配置里已有的机器人，点一下直接用（沿用它原来的 project 名、work_dir 和人设，人设只有你勾了「改」才会写）；没有就按提示去[开发者后台](https://discord.com/developers/applications)
     建应用 → Bot → Reset Token，打开 **Message Content Intent**，把 token 填进来。向导校验 token（没开 intent 会提醒），
     列出机器人所在的服务器让你选，再列出频道选默认聊天频道（多个机器人组队时，不 @ 也听只在这个频道里；@ 机器人和私聊在哪都照常，写进配置的 `group_reply_all_channels`）。机器人还没进这个服务器时给邀请链接。
     一个机器人 = 一个角色，「再加一个机器人」加下一个。
   - 飞书：扫码，自动建应用；扫完列出机器人所在的群，选默认聊天群（还没进群就先跳过，私聊照样能用）。
3. **本机 CLI**：只列出这台机器上装了的（claude、codex、gemini、opencode 等），带版本和登录状态。默认用 CLI 自己的本地登录。
   这个选择对每个角色分别保存，允许多个角色重复选择同一种 CLI；角色独立不等于获得独立的账号额度。
   想用第三方 API，勾「改用第三方 API」，选服务商、填 key（下面「第三方 API × 本机 CLI」）。
   「复制提示词」会生成一段话，交给本地 CLI 让它自己配。
4. **人设**：点一个默认人设（橘、鲸鱼娘、龙娘、彩虹猫、渡鸦）填进去再改，或者自己写，或者留空。
   默认人设是本项目作者自己团队的几个角色，只是示例，用不用都行；留空就是 CLI 本来的样子，只多一行回答语言。默认人设按网页语言给中文或英文版（日文界面给英文正文、日文名字）。
   「回答语言」默认等于网页语言，可改，写进人设文件，机器人按它回答。
   已经配过的机器人再进向导时，不勾「改这个机器人现有的人设」就什么都不改，回答语言也是人设里原来那个，不跟右上角走；
   页头和最后的确认页会写出每个已有机器人实际用的语言（人设里没写就说「由 CLI 自己决定」）。要改就在这一步勾上，再选回答语言。
   装完以后改人设有三种办法，改的是同一个文件（`<work_dir>/CLAUDE.md`、`AGENTS.md`、`GEMINI.md`……，按 CLI 定）：
   网页「项目」→ 角色 →「人设」；在聊天里叫机器人改；直接改文件夹里的文件。
5. **分流和主角色**：「分流：一个主 bot 决定谁回话（推荐）」默认勾着。勾着时主 bot 统一回话，被 @ 的角色照常回；bothouse 自动拉起 gate，装好 Python 3.12+ 和 jev 后自动启用智能判断。
   取消勾选 = 不用分流，各机器人按自己的设置回话（只清向导写的 gate 设置，手写的 `gate_url` 保留）。飞书没有这一步，默认开。
   主角色从这次配好的机器人里选一个，默认第一个。jev 没填、测试没过、或判断不出该谁回时，由它接话。
6. **jev**：三个框（Base URL、Key、模型），填一个能返回概率的模型。填完自动测一次（和 gate 一样问一道 A/B/C 选择题，看前 20 个候选里有没有选项字母），测的时候不写盘；
   能用就点下一步存下。不给概率或连不上就不存，换一个或跳过 jev（跳过会删掉原来的 jev.json，等于不填）。
   已经有能用的 jev 时框里预先填好，原样点下一步就是继续用它；新填的没通过时提示「仍在用旧的 …」，旧的不动。见下面「jev 和主角色」。
7. **确认**：最后一页有一栏「谁能指挥这些机器人」（`allow_from`），默认填好了机器人的所有者，也就是建机器人的你；
   想让别人也能用就加上他的 Discord 用户 ID，`*` = 服务器里所有人（机器人能在你电脑上跑命令，别随便放开）。已有机器人原来设了 `allow_from` 的不动。
8. **保存**：写进本机配置。最后一页先列出还要你做的事，不做机器人不会回话：
   - Message Content Intent 没开，或者没查到开没开 → 点链接到开发者后台 Bot 页打开 / 确认；
   - 机器人还没进服务器 → 点邀请链接拉进去。
   这两件做完不用重新跑向导，点「重启生效」就行。多个机器人时还会写「分流状态」：分流已生效，主 bot 统一回话；
   gate 由 bothouse 自动拉起，还缺 Python 3.12+ 或 jev 时会写出缺哪样，装好后自动启用智能判断（[线 1](ccm-and-wiki.md) 第 3 步）。

## 3. 让你的 AI 帮你配

在仓库目录里对 Claude Code / Codex 说一句「帮我把 bothouse 配好接上 Discord」就行：仓库根的 `AGENTS.md` / `CLAUDE.md` 告诉它用哪个命令、一次问你哪几项。
它要问你的只有：每个机器人的 token、服务器 ID（和默认频道 ID，可选）、每个角色用哪个本机 CLI（不说就用已登录的那个）。
人设、主角色、jev、`allow_from` 都有默认值，不用问。`bothouse setup apply -h` 列出了每个字段。

也可以把下面这段和你的 token、key 一起交给它：

> 帮我用 bothouse 的安装向导接口配好 Discord 机器人。先运行 `bothouse setup clis` 看本机有哪些 CLI，
> `bothouse setup matrix` 看第三方 API 挂到哪个 CLI 是原生还是转换，`bothouse setup personas` 看默认人设。
> 然后按下面的格式写一个 JSON，先 `bothouse setup apply --json <文件> --dry-run` 检查（不写任何文件），没问题再去掉 `--dry-run` 跑一次。
> token 和 key 不要打印、不要写进日志。做完把输出 JSON 里的 `warnings`（每条的 `fix` 和 `url`）和 `next_steps` 告诉我。

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
  "fallback_role": "<主角色的 project 名，不写 = 第一个>",
  "allow_from": "<谁能指挥机器人：Discord 用户 ID，逗号分隔；不写 = 机器人的所有者>",
  "jev": {"base_url": "https://api.siliconflow.cn/v1", "api_key": "<key>", "model": "<模型>"}
}
```

- 只有 `discord.guild_id` 和每个角色的 `token`（或 `reuse_project`）是必填的，最小请求：`{"discord": {"guild_id": "<服务器 ID>"}, "roles": [{"token": "<token>"}]}`。
- 返回：`ok` = 存好了且没有要你做的事；`saved` = 配置已写入；`needs_user_action` 为 true 时看 `warnings` 里 `blocking: true` 的项
  （`message_content_intent_off`：去开发者后台打开 intent；`bot_not_in_guild`：打开 `url` / `invite_urls` 里的邀请链接；`agent_not_logged_in`：照 `fix` 登录这台机器上的 CLI；
  `discord_token_invalid`：重置 token），不做机器人不会回话；
  `next_steps` 写了怎么启动或重启。`ok` 为 false 时退出码是 1（存好了但还要你做事也是 1）。`gate_python_missing`（没找到 Python 3.12+）只是提示，不阻塞：分流照样生效，装好后 bothouse 自动起 gate。`gate_status` 是分流的状态（`off`、`running`、`starting`、`python_missing`、`python_too_old`、`jev_missing`），`gate_hint` 是给人看的一句话。多个机器人时分流默认开，请求里加 `"gate": {"enabled": false}` 才关。
- `allow_from` 不写时，默认是每个机器人所属 Discord 应用的所有者（用 token 查）；写进新机器人，和原来 `allow_from` 为空的已有机器人，已有非空的不动。查不到所有者（Discord 应用接口没回）时不会放开：写成 `allow_from = "set-your-discord-user-id"`（谁都不听），返回阻塞的 `allow_from_unknown`，要用户给自己的 Discord 用户 ID 再跑一次。只有显式写 `"*"` 才是服务器里所有人（会附一条不阻断的 `allow_from_everyone` 提醒）。照提示带上真实 ID 重跑时，占位值会被换掉。
- `reuse_project` 的机器人保留原 project 名、CLI、work_dir、服务器；它的人设文件只有同时带了 `persona` 和 `"edit_persona": true` 才会改。
  新机器人的名字和配置里已有的项目撞了：是同一个机器人（bot ID 一样）就更新那个项目，不是就加 -2、-3。
  主角色可以用 `fallback_bot_id`（机器人 ID）指定，网页就这样传。
  CLI 在 PATH 之外（如 `~/.local/bin`）找到时，把绝对路径写进该项目的 `cmd`，重启后也找得到。
  多个机器人组队时，已有的 `allow_bots` 取并集，自己改过的 `gate_url`、`gate_fallback`、`team_lead_bot`、`group_reply_all` 不动。
- 第三方 API：`custom` 必须给 `base_url`；硅基流动、OpenRouter、本机模型、custom 必须给 `model`。
- 每项都能省：`agent_type` 不写 = 本机第一个已登录的 CLI（一个都没登录时退回第一个装了的，并返回阻塞的 `agent_not_logged_in`，`fix` 写了怎么登录）；
  project 名不写 = 机器人名转成小写的 a-z、0-9、`-`、`_`（project 名要进路径、URL 和 `gate_url ?bot=`），机器人名里一个这样的字符都没有（例如全是中文）时是 `role-1`、`role-2`……，`steps` 里有一条 `project name` 说明，机器人在群里显示的名字不变，想要别的 project 名就写 `project`；
  `work_dir` 不写 = `~/.bothouse/roles/<project>`。
- 回复语言：角色的 `reply_language` > 请求的 `language`（或 `--lang`）> 本机 locale（`LANG`）。语言代码原样写（`zh-TW`、`ko` 不会被改）。
  网页向导：右上角（顶栏）选的语言就是默认回复语言，向导顶部显示「机器人回复语言：X」，每个角色在「人设」一步还能单独改；向导文案有中、英、日，其他语言界面显示英文。结果里每个角色有 `reply_language`、`reply_language_from`（role / request / system / existing），
  没指定时另有一条不阻断的 `reply_language_default` 提醒。已配好的机器人在 role 里带 `reply_language` 重跑，只改人设文件里 `<!-- conest:reply-language -->` 下面那一行，其余不动。
- token 无效（Discord 回 401）时什么都不写，返回阻塞的 `discord_token_invalid`，`url` 是开发者后台，去 Bot → Reset Token 换新的再跑。
- 同一个 token 只能有一个 bothouse 在线。这个机器人已经在别的电脑或进程上跑着时，两边会各回一遍，先停掉旧的；向导查不出别的机器上有没有在跑，所以 dry-run 也不会提醒。
- 同样的 JSON 也能 `POST http://localhost:<管理端口>/api/v1/setup/apply`（`Authorization: Bearer <management token>`），返回同一份 JSON。
- 飞书：`"platform": "feishu"`，加 `"feishu": {"app_id", "app_secret", "chat_id"}`（app_id/secret 来自扫码或 `bothouse feishu setup`），`roles` 只放一个。
- 网页向导最后一步「给 AI」里有当前这套配置的命令，密钥是占位符。
- 返回里 `jev_ok` 为 false 时 jev 没有写入，`jev_reason` 说明原因（不给概率 / 连不上 / 接口拒绝了测试请求，例如 mlx_lm.server 最多给 11 个候选、gate 要 20 个）。复用的机器人 token 写成 `"${环境变量}"` 时，向导用当前进程的环境变量去校验，配置里仍保留占位符；变量没设会直接报出变量名。

## 4. 第三方 API × 本机 CLI

`bothouse setup matrix` 的结果（2026-10-20）。「原生」= 这家有给这个 CLI 用的接口，直接连；「转换」= bothouse 在本机
起一个转换口，把 CLI 的协议（Claude 的 Messages、Codex 的 Responses、Gemini 的 generateContent）转成 `/chat/completions`，
key 只留在 bothouse 里。所以任何 OpenAI 兼容接口都能挂到这四个 CLI 上。

| 服务商 | Claude Code | Codex | Gemini CLI | OpenCode |
|---|---|---|---|---|
| 硅基流动 | 原生 | 转换 | 转换 | 原生 |
| OpenRouter | 原生 | 原生 | 转换 | 原生 |
| DeepSeek | 原生 | 原生 | 转换 | 原生 |
| MiniMax（中国站 / 国际站） | 原生 | 原生 | 转换 | 原生 |
| 本机模型（Ollama、LM Studio、llama.cpp…） | 转换 | 转换 | 转换 | 原生 |
| 其他 OpenAI 兼容接口（自填 Base URL） | 转换 | 转换 | 转换 | 原生 |

接口地址的来源在 `bridge/core/setup_detect.go` 的 `WizardVendors`。别的 CLI（Cursor、Copilot、Kimi、Qoder…）bothouse 里不能挂第三方 API，
只能用它们自己的登录；WorkBuddy 装了会显示，但 bothouse 还没有它的适配器，不能选。

## 5. jev 和主角色

安装向导的「群聊参与方式」现在明确提供：

| 方式 | 适合什么情况 | 是否需要小模型 |
| --- | --- | --- |
| 智能分流 | 希望系统判断未点名的追问该谁接 | 规则之外需可用 jev；没有时主角色兜底回复 |
| 仅被点名时回复 | 希望主控少插话，优先节省资源 | 不需要 Python、jev 或本地 0.6B 推理 |
| 关闭分流 | 保留旧的各机器人回复设置 | 不启用向导 gate；可能每个机器人都回复 |

「仅被点名」在群聊使用 @；Discord 也支持回复该角色的消息，自建平台也支持开头叫名字。私聊、明确的队友交回和停手命令沿用平台现有规则；飞书已参与的线程仍可继续。未点名的追问不会被猜测为发给上一个角色。选择会保存，重新打开向导或添加角色时保持；作用于当前平台的整支团队，不改其他平台和手写 gate URL。同一个项目若在其他平台还使用 gate，该 gate 会保留。「关闭分流」不是安静模式。

AI / CLI 安装同样支持，在原来的安装请求里加：

~~~json
"gate": {"enabled": true, "mode": "addressed"}
~~~

这是请求中的一个字段。`mode: "smart"` 恢复智能分流和未点名消息接收；省略 `gate` 保留该平台已保存的选择，老的 `{"enabled": false}` 仍保持原来的关闭行为。`--dry-run` 不保存选择或配置。

本地 **Qwen3 0.6B** 的说明已有，但向导不会下载或启动模型。若继续用智能分流，先自行起 OpenAI 兼容接口，例如 Apple 芯片上的 `mlx_lm.server --model mlx-community/Qwen3-0.6B-4bit`，再在 jev 步骤填 Base URL 和模型名，并通过概率测试（logprobs）。它省去远程路由 API 的费用，仍占本机内存和算力；角色执行任务所用模型的费用另算。完全不运行路由模型的便宜替代就是「仅被点名时回复」。


- **jev 用来判断群里一句话该哪个角色回**：gate 每条消息先走规则（@ 了谁、开头叫了谁），规则判不了再让 jev 读几个选项的概率。
- 推荐：硅基流动（如免费 Qwen 小模型）、OpenRouter、DeepSeek、MiniMax、本地小模型（如 Qwen 0.6B）。
  不推荐 Claude、GPT：它们的接口不给概率。jev 也不能复用 Claude Code / Codex 的本地登录，同样是因为拿不到概率。
  WorkBuddy 是助手产品，不是模型服务，所以不在这里，装了会在第 3 步出现。
- 测法和 gate 一致：一个字的请求，要前 20 个候选的概率，A/B/C 至少一个在里面才算能用（`contrib/gate/scorer_remote.py` 同一条件）。
  请求里带 `chat_template_kwargs: {"enable_thinking": false}`（Qwen3 一类模型默认先出 `<think>`）；服务在 400 里说明 top_logprobs 上限（如 mlx_lm.server 最多 11）或不认这个字段时自动调整重试，找到的参数存进 `jev.json`，gate 照用。回一个字超过 2.5 秒（gate 的等待上限）判为太慢。
  实测（2026-10-20）：mlx_lm.server + Qwen3-0.6B-4bit 能通过并能打分；LM Studio（MLX 引擎）回 `logprobs: null`，当不了 jev。
  能用才写 `jev.json`；不能用就不写，原来能用的旧 jev 保留并在原因里写「仍在用旧的 …」——新填错一次不该悄悄把选角色关掉。
  一键命令和接口同样：`jev` 不给 = 不动；`"jev": {"base_url": ""}` 也是不动；`"jev": {"remove": true}` = 删掉；没存时返回 `"jev_ok": false`、`jev_reason`，`jev_in_use` 是现在生效的那个。
- **没有可用的 jev**（没填、测试没过）：bothouse 不起 gate（`gate_status` = `jev_missing`），去这一步填 jev（硅基流动的免费 Qwen 小模型，或本地起一个 Qwen3 0.6B）后自动起；
  gate 不会自己下载模型。**gate 没在运行**时分流照样生效：被 @ 的角色照常回，其他消息由主角色回
  （bothouse 的 `gate_fallback`：主角色 `reply`，其他 `context`；被 @ 时一律 `reply`，见 `bridge/core/gate.go`）。

## 6. 向导写了什么（给别的程序读）

都在 bothouse 的数据目录（默认 `~/.bothouse`）：

| 文件 | 内容 | 谁读 |
|---|---|---|
| `config.toml`（写之前把原文件备份成 `config.toml.bak-<时间>`，每次一份、不覆盖：重写会丢注释，注释从备份里找回；所有写配置的路径共用一把文件锁，向导和正在跑的服务不会互相覆盖） | 每个机器人一个 `[[projects]]`：token、`guild_id`、CLI、第三方 API（`api_format = "openai_chat"` 表示走本机转换）；多个 Discord 机器人时还有 `group_reply_all`、`share_session_in_channel`、`allow_bots`、`team_lead_bot`、`gate_url`、`gate_fallback` | bothouse |
| `roles/<project>/CLAUDE.md` 等 | 人设 + 回答语言（`<!-- conest:reply-language -->` 之后那行） | 对应的 CLI |
| `jev.json`（权限 600） | `{"backend": "llm", "url", "model", "api_key", "logprobs", "tested_at"}` | gate（`contrib/gate/scorer_remote.py`）；角色小家 `[discord.router] key_file` |
| `gate-team.json` | `{"lead": 主角色, "subs": 其他角色}`，key 是 project 名 = `gate_url` 的 `?bot=` | gate |
| `conest-setup.json` | 平台、服务器 ID、默认频道 ID / 飞书默认群、主角色、团队（不含密钥）；自建平台另记 `cloud_web_url`、`cloud_web_fallback`、`cloud_web_team`，不动 Discord 的那几项 | 向导下次打开时；角色小家要默认频道时照抄 `channel_id` |
| `hub/hub.json`（权限 600）、`hub/hub.sqlite3`、`hub/hub.log`、`hub/src/` | 向导「在本机启动」的自建平台：端口、网页登录 token、机器人 token；消息库；日志；解出来的程序 | bothouse（启动时平台没在跑就拉起来） |

## 7. 自建平台

自建平台是 role-household 的 hub（`role-household/rh/hub.py`）：一个自己的聊天网页，像 Grok 那样打开就聊，`@名字` 叫哪个角色就哪个回。
bothouse 只是接进去：每个角色作为一个成员连平台的机器人入口（cloud_web 平台，`?bot=<project>`）。

```
 选「自建平台」─▶ 本机有平台在跑？ ── 向导起的 ──▶ 地址和 token 自动填好
                     │               └ 别人起的 ──▶ 地址填好，填它的 token，自动测连接
                     └ 没有 ──▶「在本机启动」（要 uv）    或「连别人的平台」：填地址 + token，自动测连接
               ─▶ 角色名（每个角色一个，可「再加一个角色」，已有的 Discord 机器人也能点一下接进来）
               ─▶ 本机 CLI ─▶ 人设 ─▶（多个角色时）主角色、jev ─▶ 保存 ─▶ 重启生效 ─▶「打开自建平台」
```

- **在本机启动**：bothouse 安装包里带着平台程序；起它要本机有 [uv](https://docs.astral.sh/uv/getting-started/installation/)（没有时按钮不能点，页面说怎么装）。
  第一次会联网下载 Python 和两个依赖（aiohttp、cryptography），约半分钟；之后几秒。平台只听 127.0.0.1，端口默认 8790（被占时换一个空的），
  数据在 `<数据目录>/hub/`。重启 bothouse、重启电脑后，bothouse 启动时发现它没在跑会再拉起来。
- **测试连接**：和机器人一样连一次平台的 WebSocket，不注册，平台上不会多出成员。地址错（连不上 / 不是机器人入口）和 token 错（401）分别说怎么改。
  token 错、地址错时什么都不写；平台暂时连不上时照样保存，并在结果里阻塞提醒 `cloud_web_unreachable`。
- **写进配置**：每个角色的 `[[projects.platforms]]` 加一段 `type = "cloud_web"`：`transport = "websocket"`、`ws_url = "ws(s)://<平台>/cloud-web/ws?bot=<project>&name=<名字>"`、
  `token`、`allow_from = "user"`（平台里的人是 `user`）、`share_session_in_channel = true`、`group_reply_all = true`（hub 要求这两项，见 `rh/cloudweb.py` 文件头）。
  已有的 Discord 机器人接进来时 Discord 那段原样不动，还会带上 `mention_id=<Discord bot ID>`，人设里写的 `<@id>` 在平台上也能 @ 到它。
  同一个平台上同名的角色再跑一次是更新原来那个，不会多出 `名字-2`。
  每个角色的 `ws_url` 都带 `mention_id`（只能是数字：已有的沿用；接进来的 Discord 机器人用它的 Discord ID；都没有就由平台地址和项目名算出一个 18 位数，重跑不变）。
  多个角色时像 Discord 组队一样：除主角色外每个角色写 `team_lead_bot = <主角色的 mention_id>`，主角色 @ 队员派的活，队员做完的最终回复自动带上 @主角色
  （`bridge/platform/cloud-web/lead_return.go`）；写 `gate_url` / `gate_fallback`（已有 gate 设置的项目不动）；向导写的人设里加一行 `<!-- conest:team -->`
  （和回答语言那行同一种做法，开头写明「在自建平台上」，同一份人设也给 Discord 用时不混）：主角色知道有哪些队员、用「@名字」派活，队员知道主角色是谁。
  已有机器人没勾「改人设」时也只更新这一行，结果里逐个写明；自己写的、没有向导标记的人设不动，结果里也会说。
- **给 AI**：`bothouse setup hub` 看本机平台、`bothouse setup hub start` 起一个，然后
  `bothouse setup apply --json` 发 `{"platform": "cloud_web", "roles": [{"name": "<名字>"}]}`（本机向导起的平台地址和 token 自动填；连别人的加
  `"cloud_web": {"url": "<地址>", "token": "<token>"}`）。字段见 `bothouse setup apply -h`。
- 以后要接的 DSH 网页走同一个协议，只是多一个预设（`bridge/core/setup_cloudweb.go` 的 `cloudWebPresets`，`allow_from` 不同）。

## 8. Codex 会话不要混进桌面

Codex 角色默认可能与桌面共用 `~/.codex`，所以平台聊天也会出现在桌面会话列表。给该角色的 `[projects.agent.options]` 配置独立 `codex_home`，先准备好登录与模型配置，再重启 bothouse。已有会话需要按 ID 迁移并验证恢复，随后才能归档桌面旧副本；换工作目录不能隔离存储。完整步骤见 [Codex 机器人与桌面会话隔离](codex-session-isolation.md)。

## 附录 A：手动接 Discord

### A1. 每个 bot 建一个应用

详细截图步骤见 [bridge/docs/discord.md](../bridge/docs/discord.md)。要点：

1. [Discord 开发者后台](https://discord.com/developers/applications) → New Application → Bot → Reset Token，复制 token。
   一个角色一个应用、一个 token。
2. Bot 页打开 **Message Content Intent**（不开读不到消息正文）。
3. OAuth2 → URL Generator：scopes 勾 `bot`、`applications.commands`；权限至少勾查看频道、发消息、读消息历史、加反应；团队模式还要管理频道（建工作区）和置顶消息。向导给的邀请链接已带齐这些权限；频道单独设了权限的，要去频道设置里给 bot 放开。
   如果 bot 已在服务器，请到「服务器设置 → 身份组」里，给 bot 的身份组勾上缺的权限，重新点链接不会更新权限。
   用生成的链接把 bot 拉进你的服务器。
4. token 写进 `~/.bothouse/config.toml` 对应 project 的 `[projects.platforms.options] token`，不进任何仓库。

### A2. 拿 ID

向导里服务器和频道是点选的，`allow_from` 默认就是你，一般用不到这一节。要手动填 ID 时（例如让 AI 跑 `setup apply`）：
Discord 设置 → 高级 → 打开**开发者模式**。之后右键就能「复制 ID」（右键服务器图标 → 复制服务器 ID；右键频道 → 复制频道 ID）：

- 你自己的用户 ID → `allow_from`（只听你的话；向导默认已填）。
- 每个 bot 的用户 ID → 别的 bot 的 `allow_bots`、所有 bot 的 `team_lead_bot`（填主 bot 的）。
- 服务器 ID、频道 ID → 角色小家的 `roles.toml`（下面「默认发言频道」）。

### A3. 一主多 sub 的选项

都在每个 bot 的 `[projects.platforms.options]`，完整例子见线 1 第 2 步：

- `group_reply_all = true`：群里不 @ 也听，交给 gate 判断回不回。
- `share_session_in_channel = true`：一个频道一份会话。
- `allow_bots`：队友 bot 的 ID。队友 @ 我才开一轮，没 @ 只当上下文；不列的 bot 的消息全忽略。
- `team_lead_bot`：主 bot 的 ID。没配 gate 时，群里没点名的消息由主 bot 接，sub 只听；点了谁的名就由谁接。

### A4. 怎么验证

Discord 的 `/new` 等斜杠命令也可在与机器人的私聊中使用。配置了 `guild_id` 时，服务器命令仍即时注册，另注册仅在机器人私聊显示的全局命令，因此服务器菜单不会出现两份；未配置 `guild_id` 时，同一套全局命令用于服务器和私聊。全局命令在 Discord 客户端显示可能有传播延迟。

- 群里说一句闲聊，主 bot 按 gate 的判断回或不回；`~/.bothouse/gate.jsonl` 里有这句的判断。
- 「码农，帮我看下 X」→ 只有码农回；主 bot @ 码农派活 → 码农接，做完 @ 回来。

## 附录 B：飞书命令行

### 1. 扫码接入一个 bot

```sh
bothouse feishu setup --project <你的 project 名>
```

终端里出二维码，用飞书手机 App 扫码，会自动建企业自建应用、开机器人能力、配权限和事件订阅，并把 App ID、App Secret
写回配置。不想扫码、已有应用时：`bothouse feishu setup --project <名> --app cli_xxx:sec_xxx`。
手动建应用的完整步骤见 [bridge/docs/feishu.md](../bridge/docs/feishu.md)。飞书用长连接，不需要公网 IP。

### 2. 飞书上目前没有的

这些只在 Discord 上实现了，飞书上一个 bot 照常对话，但：

- gate 拿不到「这句 @ 了谁」（`mentioned` 只有 Discord 填），只能靠消息里叫的名字判断。
- 没有 `allow_bots`、`team_lead_bot`：bot 之间不会互相接话、交接。
  所以飞书上先只放一个 bot，不要把一主多 sub 原样搬过去。

### 3. 怎么验证

私聊或在群里 @ 这个 bot 说一句，它回话；ccm 日志里有这条消息。
