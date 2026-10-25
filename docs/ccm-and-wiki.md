# 线 1：配 ccm 和 wiki

做完这篇：本机跑着 ccm（bothouse maomao 分支），一个主 bot 加几个 sub；gate 判断谁回话（向导默认开，bothouse 自动拉起）；
每轮回话前 bot 会收到「可能相关的 wiki 页」；会话结束后 wiki 自动多出记录。
装和配机器人只有一条路：[从零用起](GETTING_STARTED.md)的「装 → 向导 → 确认上线」。这篇讲 gate（向导默认开，不用手动起）和可选的 wiki。

## 0. 要准备的

- 本文的安装和后台运行命令面向 macOS 或 Linux；Windows 的 wiki 检索支持范围见第 4 节。gate 用向导里填的 jev 打分，不带本地模型。
- 装 ccm 不用 Go，也不用 Node：用预编译包（第 1 步）。gate 要 Python 3.12+（bothouse 自动拉起，不用 uv）；wiki 要 Python 3.9+ 和 git。
- 已登录的 `claude` CLI（也可以是 codex 等 bothouse 支持的 agent）。
- 每个 bot 一个聊天平台的 bot 账号（线 2 第 1 步）。

## 1. 装 ccm

照[从零用起](GETTING_STARTED.md)第 1 步，一行命令装预编译包（带网页向导）。
不要用 npm / brew 装：那是上游 bothouse，没有安装向导、gate 和一主多 sub。想自己从源码编见文末附录 B。
开发与贡献流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 2. 配机器人：用向导

运行 `bothouse`，浏览器里的向导会写好一主多 sub 的全部配置（每个机器人一个 `[[projects]]`，以及 `allow_from`、`allow_bots`、
`team_lead_bot`、`gate_url`、`gate-team.json`），见[线 2](connect-discord-feishu.md)。也可以让 AI 跑 `bothouse setup apply`。
已经用向导配过的直接跳到第 3 步。手写 TOML 的老办法放在文末附录 A。

## 3. 起 gate：向导默认开，bothouse 自动拉起

**不用手动起。** 多个机器人时，向导「主角色」一步的「分流：一个主 bot 决定谁回话（推荐）」默认勾着（AI 的请求不带 `gate` 字段也是开）。
保存后分流马上生效：主 bot 统一回话，被 @ 的角色照常回，其他角色只听。
bothouse 会自己拉起 gate（服务在跑就马上起，没在跑就下次启动时起），装好 **Python 3.12+** 和 **jev** 后自动启用智能判断，不用重跑向导。

- jev 在向导里填（[线 2](connect-discord-feishu.md) 第 5 节：硅基流动的免费 Qwen 小模型，或本地起一个 Qwen3 0.6B）。gate 不会自己下载模型。
- 还缺 Python 或 jev 时，保存页会写出缺哪样（`gate_status`：`python_missing`、`python_too_old`、`jev_missing`），分流照样生效，只是先由主 bot 统一回话。
  bothouse 每分钟复查一次，装好就自动起 gate。
- bothouse 起的 gate 跟着 bothouse 走：bothouse 退出它也退出，崩了会自动重启。脚本释放在 `~/.bothouse/gate/`，
  运行日志在 `~/.bothouse/logs/gate.log`，判断日志在 `~/.bothouse/gate.jsonl`（用来调规则）。
- 团队文件向导已经写好（`~/.bothouse/gate-team.json`，lead = 向导里选的主角色）；jev 在 `~/.bothouse/jev.json`（测出给概率的才用）。
  向导保存后 bothouse 会重启自己起的 gate，让它读到新的团队和 jev。
- 不想要分流：在向导里取消勾选（AI：请求里加 `"gate": {"enabled": false}`）。只清向导写的 gate 设置，自己手写的 `gate_url` 保留。

### 高级：自己起 gate

一般用不到。9930 端口上已经有别的 gate 在跑时，bothouse 不会再起，也不会去管它。想自己管 gate（换端口、放到别的机器、用本机大模型）才看这里。
下面的命令在 conest 仓库根目录运行，要 [uv](https://docs.astral.sh/uv/)：

```sh
GATE_WIKI=~/wiki uv run bridge/contrib/gate/gate.py
# → gate on 127.0.0.1:9930  team=协调员+码农、笔杆  wiki=/Users/you/wiki
```

- 没用向导时自己写团队文件：`cp bridge/contrib/gate/team.example.json ~/.bothouse/gate-team.json` 再改成你的角色
  （名字是群里叫她的叫法，`subs` 的 key 就是 `gate_url` 里 `?bot=` 后面那个）。格式：

  ```json
  {"lead": {"name": "协调员", "aliases": ["Claude"]},
   "subs": {"coder": {"name": "码农", "aliases": ["Codex"]}}}
  ```

- 没有 jev 时 gate 启动就报错退出，提示两种填法：用硅基流动的免费 Qwen 小模型，或本地起一个 0.6B 小模型（如 `mlx_lm.server --model mlx-community/Qwen3-0.6B-4bit`）再填进向导的 jev。
  启动时打印的 `scorer=jev` 就是在用 jev。
- 长期跑用 launchd 或 `nohup`，日志写到文件；不要挂在某个会话上。
- 想在自己的显卡上跑大一点的本机模型：显式设 `GATE_MODEL=<本地模型目录>`，Apple 芯片用 `bridge/contrib/gate/scorer.py`（`uv run --with mlx-lm`），
  N 卡用 `scorer_torch.py`（PyTorch 版，放成 `scorer.py`）；`gate_switch.py`
  演示了把 gate 放在另一台机器上、连不上时退回规则（要先设 `SWITCH_HOST`、`SWITCH_TS_IP`；同步脚本 `sync_gate.sh` 另要 `SWITCH_WIN_HOME`）。这两样按你的机器改，不在这篇的范围内。

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
- wiki 页应保存为 UTF-8；`wiki_search.py` 和 `/context` 的词法检索支持 Windows 中文系统（cp936），无需设置 `PYTHONUTF8=1`。返回的路径统一使用 `/`，家目录下仍缩写为 `~/...`。此支持范围仅涵盖词法检索；本篇 shell 安装命令、launchd 和本机模型后端仍按各自的平台要求使用。
- 同一页同一个会话只推一次（ccm 记着）。wiki 改了最迟 5 分钟后检索得到。
- 只有 `MEMORY.md` → 域目录（有 `README.md`）→ 主题页这样的页会被检索；根目录的 `MEMORY.md`、`log.md`、各 `README.md` 不算。

## 5. 起 ccm

```sh
bothouse                  # 读 ~/.bothouse/config.toml；或 --config <路径>
bothouse daemon install   # 想关掉终端也一直在线：装成后台服务
```

## 6. 怎么验证

1. ccm 上线：日志里有 `discord: connected`；频道里 @ 机器人说一句，它回话。
2. gate 活着（装好 Python 3.12+ 和 jev 后 bothouse 自动拉起；起不来看 `~/.bothouse/logs/gate.log`）：
   ```sh
   curl -s 127.0.0.1:9930/decide -d '{"content":"你好","busy":false}'          # → {"action": ..., "reason": ...}
   curl -s 127.0.0.1:9930/context -d '{"key":"t","text":"<wiki 里有的一个词>"}'   # → {"wiki": [...]}
   ```
3. 不加载模型的单元测试（仓库根目录）：
   ```sh
   python3 -I bridge/contrib/gate/test_ctxsvc.py && python3 -I bridge/contrib/gate/test_gate_context.py
   ```
4. 群里发一句跟 wiki 有关的话，主 bot 的回答里能看出读过那页；ccm 日志里没有 `gate: context fetch failed`。
5. 叫 sub 的名字（「码农，看下这个」），只有她回；不叫她，她不开口。
6. 结束一个 Claude Code 会话，过一会儿 `cd ~/wiki && git log -1` 能看到整理进来的提交。

## 附录 A：手写 TOML（不用向导时）

向导写的就是下面这些。只有不想用向导时才手写：先跑一次 `bothouse` 让它生成 `~/.bothouse/config.toml`（Ctrl+C 退出向导），
再往里加 `[[projects]]`（每个 bot 一个 project；完整示例 `bothouse config example`，`# ---- maomao fork` 那段有每一项的说明）：

```toml
[[projects]]
name = "lead"                                  # 主 bot
gate_url = "http://127.0.0.1:9930/decide"
team_status_dir = "~/.bothouse/team"
team_name = "协调员"
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
team_status_dir = "~/.bothouse/team"
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

token 不要提交进任何仓库。`~/.bothouse/config.toml` 只放在本机。ID 怎么拿见[线 2 附录 A2](connect-discord-feishu.md#a2-拿-id)。

## 附录 B：从源码编（开发用）

要 Go 1.25（版本见 `bridge/go.mod`）；带网页向导还要 Node。在仓库根目录：

```sh
cd bridge
make build          # 带网页向导的完整版，约 3–5 分钟；npm 和 go 打印的一堆警告、downloading 行可以忽略
make build-noweb    # 不要网页时（不用 Node）；setup apply 命令照样能用
```

编出来的是 `bridge/bothouse`。
