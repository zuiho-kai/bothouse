# 每个角色一个 wiki + 夜间反思（作者本机原样搬运）

这里是作者本机正在跑的那套，代码没重写，只把写死的路径、角色名、频道 ID 改成了参数/配置：

- `bin/ingest.py`：会话结束后把新内容整理进 wiki；`--nightly` 夜里补漏、审查、做 dream（今日反思、规则候选，
  引文逐字核对用户原话）；`--lint` 每周体检。依赖同目录的 `sessionlog.py`、`daypack.py`、`codex_daypack.py`、
  `lint.py`、`search.py`。
- `bin/teammate/`：sub 角色 wiki 里的 `bin/ingest.py` / `lint.py` / `search.py` 转发壳，转到共享的 `bin/`。
- `export.py`：把 sub 角色（Codex / Antigravity / DSH）的会话和日记转成 ingest 读的转录。DSH 记录压缩（默认 zstd）和不压缩都能读，
  用的是 `../hooks/dshlog.py`（和 hook、peek 同一份），DSH 那边不用关压缩。
- `sub-wiki.sh`：sub 角色的触发入口（pending / nightly / lint / cc-connect `agent.closed` 钩子）。
- `setup_wiki.py`：给每个 sub 角色建一本自己的 wiki（从 llm-wiki 模板克隆）。

## 向导默认做的事

向导（网页或 `cc-connect setup apply`）给每个新角色（任何 CLI）默认开一本自己的 wiki 和夜间反思，下面第 2、3 步不用手做：
程序装到 `<data_dir>/wiki/`（配置里已有指向 `sub-wiki.sh` 的 `agent.closed` 钩子时，用那一套）；没有主 wiki 时从
`template/`（[llm-wiki](https://github.com/zuiho-kai/llm-wiki) 模板的副本）建一个，放共享程序；在 `bots.json` 登记角色
（`kind` = 它的 agent 类型：codex、dsh、claudecode、agy 读各自的会话，其他类型只读日记），跑 `setup_wiki.py` 建它的 wiki，
加一次 `agent.closed` 钩子，人设里写上 wiki 在哪和怎么关。整理模型默认用这个角色自己的 CLI，向导里选了就按选的。
关：角色的用户在聊天里说一声，角色运行 `export.py --switch <角色> wiki|dream off`（`on` 打开）。

## 安装（和作者本机一样：gate + wiki 都装）

1. 装 gate（`../gate`，见 `gate.py` 开头），团队文件 `gate-team.json`。
2. 主角色 wiki：把 llm-wiki 模板放到 `~/wiki`，把本目录 `llmwiki/*.py` 复制到 `~/wiki/bin/`（`teammate/` 一起）。
   在 `~/wiki/config.json` 写主角色是谁（不写就是占位名 `assistant`）：

   ```json
   {"assistant": "主管", "bots": {"主管": ["主管"], "码农": ["码农"], "笔杆": ["笔杆"]},
    "user_names": ["你的群昵称"], "rule_files": ["~/.claude/CLAUDE.md"],
    "dream_notify": "<cc-connect 项目> <会话 key，如 discord:频道ID>"}
   ```

   可用键见 `bin/ingest.py` 的 `DEFAULTS`；会话来源默认是本机 Claude Code 日志，角色名用环境变量
   `AGENT_ROLE`（和 `assistant` 一致），更多来源写 `sources.json`（见 `sessionlog.py` 开头）。
   Claude Code 的 SessionEnd hook：`python3 -I ~/wiki/bin/ingest.py --hook`。
3. sub 角色：`cp bots.example.json bots.json` 填好各角色（或用 `WIKI_BOTS` 指到别处），然后
   `LLM_WIKI_SRC=<llm-wiki 路径或 git 地址> WIKI_LEAD=主管 WIKI_USER=你的群昵称 python3 setup_wiki.py coder writer`。
   cc-connect 配 `agent.closed` 钩子：

   ```toml
   [[hooks]]
   event = "agent.closed"
   type = "command"
   command = "python3 -X utf8 -I <本目录>/sub-wiki.py hook"                 # Mac / Linux
   # command = "& python -X utf8 -I '<本目录>\\sub-wiki.py' hook"           # Windows（PowerShell）
   ```

4. 定时：向导（网页或 `cc-connect setup apply`）发现 `~/wiki/bin/ingest.py`（或 `$WIKI_DIR`）时已自动加好下面三条
   静音任务（挂在兜底角色和默认频道上，重跑不会重复），三项模型也在向导里选。手动加法如下
   （`--exec` 的输出默认会发到该会话，`--mute` 什么都不发）：

   ```sh
   S="--project <主角色项目> --session-key <会话 key> --mute"
   cc-connect cron add $S --cron "*/30 * * * *" --exec "python3 -I ~/wiki/bin/ingest.py --pending; sh <本目录>/sub-wiki.sh pending" --desc "wiki ingest"
   cc-connect cron add $S --cron "0 3 * * 1-6"  --exec "python3 -I ~/wiki/bin/ingest.py --nightly; sh <本目录>/sub-wiki.sh nightly" --desc "wiki nightly + 反思"
   cc-connect cron add $S --cron "0 3 * * 0"    --exec "python3 -I ~/wiki/bin/ingest.py --lint; sh <本目录>/sub-wiki.sh lint" --desc "wiki weekly lint"
   ```

环境变量：`WIKI_DIR`（主 wiki，默认 `~/wiki`）、`WIKI_BIN`（共享工具目录，默认 `~/wiki/bin`）、`WIKI_BOTS`、
`WIKI_TRANSCRIPTS`（转录输出，默认本目录 `transcripts/`）、`WIKI_PYTHON`、`AGENT_ROLE`、`LLM_WIKI_SRC`。
模型引擎（haiku / sonnet / codex …）在向导里选，或在 config.json 的 `*_engine` 键改。
