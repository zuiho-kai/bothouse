# 线 1：配 ccm 和 wiki

做完这篇：本机跑着 ccm（cc-connect maomao 分支），一个主 bot 加几个 sub；gate 判断谁回话；
每轮回话前 bot 会收到「可能相关的 wiki 页」；会话结束后 wiki 自动多出记录。
聊天平台怎么接（Discord 建 bot、飞书扫码）见[线 2](connect-discord-feishu.md)，这篇只用到它的结果（bot token、频道）。

## 0. 要准备的

- macOS（Apple 芯片）。gate 的本地模型用 mlx，只在 Apple 芯片上跑；别的机器见第 3 步末尾。
- Go 1.22+（编 ccm）、[uv](https://docs.astral.sh/uv/)（跑 gate）、Python 3.9+ 和 git（wiki）。
- 已登录的 `claude` CLI（也可以是 codex 等 cc-connect 支持的 agent）。
- 每个 bot 一个聊天平台的 bot 账号（线 2 第 1 步）。

## 1. 编 ccm

```sh
git clone https://github.com/Zssan12/conest.git && cd conest/bridge
go build -tags no_web -o cc-connect ./cmd/cc-connect   # no_web：不编网页管理界面（那个要 node）
```

它和上游 cc-connect 用同一种配置文件，上游的安装说明见 [bridge/INSTALL.md](../bridge/INSTALL.md)。
maomao 多出来的功能说明见 [bridge/MAOMAO.md](../bridge/MAOMAO.md)。

## 2. 最小配置：一个主 bot + 一个 sub

```sh
mkdir -p ~/.cc-connect && cp config.example.toml ~/.cc-connect/config.toml
```

把 `[[projects]]` 改成下面这样（每个 bot 一个 project；`config.example.toml` 里 `# ---- maomao fork` 那段有每一项的说明）：

```toml
[[projects]]
name = "lead"                                  # 主 bot
gate_url = "http://127.0.0.1:9930/decide"
team_status_dir = "~/.cc-connect/team"
team_name = "主管"
team_status_inject = true                      # 每轮开头附上队友在忙什么
[projects.agent]
type = "claudecode"
[projects.agent.options]
work_dir = "/path/to/your/workspace"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "<主 bot 的 token>"
allow_from = "<你的 Discord 用户 ID>"
group_reply_all = true                         # 群里不 @ 也听（由 gate 判断回不回）
share_session_in_channel = true
allow_bots = "<sub 的 bot 用户 ID>"             # 队友 @ 我才开一轮，没 @ 只当上下文
team_lead_bot = "<主 bot 的用户 ID>"

[[projects]]
name = "coder"                                 # 一个 sub
gate_url = "http://127.0.0.1:9930/decide?bot=coder"   # ?bot= 要和团队文件 subs 里的 key 一样
gate_fallback = "context"                      # gate 挂了只听不说，不会所有 sub 一起开口
team_status_dir = "~/.cc-connect/team"
team_name = "码农"
[projects.agent]
type = "codex"
[projects.agent.options]
work_dir = "/path/to/your/workspace"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "<sub 的 token>"
allow_from = "<你的 Discord 用户 ID>"
group_reply_all = true
share_session_in_channel = true
allow_bots = "<主 bot 的用户 ID>"
team_lead_bot = "<主 bot 的用户 ID>"
```

token 不要提交进任何仓库。`~/.cc-connect/config.toml` 只放在本机。

## 3. 起 gate

团队文件写你自己的角色（名字是群里叫她的叫法，`subs` 的 key 就是上面 `?bot=` 后面那个）：

```sh
cp bridge/contrib/gate/team.example.json ~/.cc-connect/gate-team.json   # 改成你的角色
GATE_TEAM=~/.cc-connect/gate-team.json GATE_WIKI=~/wiki uv run bridge/contrib/gate/gate.py
# → gate on 127.0.0.1:9930  team=主管+码农、笔杆  wiki=/Users/you/wiki
```

`team.example.json` 的格式：

```json
{"lead": {"name": "主管", "aliases": ["Claude"]},
 "subs": {"coder": {"name": "码农", "aliases": ["Codex"]}}}
```

- 用过[安装向导](connect-discord-feishu.md)的话，团队文件向导已经写好了（`~/.cc-connect/gate-team.json`，lead = 向导里选的兜底角色），
  不设 `GATE_TEAM` 也会读它；两样都没有才用 `team.example.json` 里的占位名字（群里叫不到你的角色，记得换）。
- gate 用哪个模型打分，按这个顺序：向导填的 jev（`~/.cc-connect/jev.json`，测出给概率的才用）→ 本机 mlx 的 Qwen3.5-4B
  （第一次运行会下载，约 3GB；换模型设 `GATE_MODEL`）→ 都没有就只按规则判，规则判不了的交给 lead（兜底角色）回。
  启动时打印的 `scorer=jev|local|rules` 就是用的哪一种。
- 判断日志在 `GATE_LOG`（默认 `~/.cc-connect/gate.jsonl`），用来调规则。
- 长期跑用 launchd 或 `nohup`，日志写到文件；不要挂在某个会话上。
- 不是 Apple 芯片：`bridge/contrib/gate/scorer_torch.py` 是 PyTorch 版打分（有 NVIDIA 显卡的机器），`gate_switch.py`
  演示了把 gate 放在另一台机器上、连不上时退回规则。这两样按你的机器改，不在这篇的范围内。

## 4. 装 wiki 并接到 gate

wiki 用公开的 [llm-wiki](https://github.com/zuiho-kai/llm-wiki)，照它 README 的「安装」做（中文见 README.zh-CN.md）：

```sh
git clone https://github.com/zuiho-kai/llm-wiki ~/wiki && cd ~/wiki
git remote rename origin upstream          # wiki 里是你的个人数据，绝不 push 到公开仓库
cp config.example.json config.json         # 中文：设 "language": "zh"，再 cp schema/CLAUDE.zh-CN.md CLAUDE.md
```

然后按它的第 4–6 步：在 `~/.claude/settings.json` 里设 `autoMemoryDirectory` 和 SessionEnd hook、把记忆指令追加进
`~/.claude/CLAUDE.md`、`launchd/install.sh` 装定时整理。**第一次运行会把所有历史会话整理一遍，可能跑几个小时、花不少额度**，
先 `python3 bin/ingest.py --status` 看有多少。

接到 gate：gate 的 `POST /context` 每轮按这条消息在 wiki 里逐行检索（BM25，不用模型），把最相关的 3 页和命中的行交给 ccm，
ccm 拼在消息前面：

```
（可能相关的 wiki 页，需要时去读）
- ~/wiki/infra/vps.md — VPS 一览 | 6: - 代理端口 7890
```

- wiki 目录用 `GATE_WIKI` 指（默认 `~/wiki`）；设成 `off` 或空就不推。目录不存在也不推，不报错。
- 同一页同一个会话只推一次（ccm 记着）。wiki 改了最迟 5 分钟后检索得到。
- 只有 `MEMORY.md` → 域目录（有 `README.md`）→ 主题页这样的页会被检索；根目录的 `MEMORY.md`、`log.md`、各 `README.md` 不算。

## 5. 起 ccm

```sh
cd conest/bridge && ./cc-connect          # 读 ~/.cc-connect/config.toml；或 -config <路径>
```

## 6. 怎么验证

1. gate 活着：
   ```sh
   curl -s 127.0.0.1:9930/decide -d '{"content":"你好","busy":false}'          # → {"action": ..., "reason": ...}
   curl -s 127.0.0.1:9930/context -d '{"key":"t","text":"<wiki 里有的一个词>"}'   # → {"wiki": [...]}
   ```
2. 不加载模型的单元测试：
   ```sh
   python3 -I bridge/contrib/gate/test_ctxsvc.py && python3 -I bridge/contrib/gate/test_gate_context.py
   ```
3. 群里发一句跟 wiki 有关的话，主 bot 的回答里能看出读过那页；ccm 日志里没有 `gate: context fetch failed`。
4. 叫 sub 的名字（「码农，看下这个」），只有她回；不叫她，她不开口。
5. 结束一个 Claude Code 会话，过一会儿 `cd ~/wiki && git log -1` 能看到整理进来的提交。
