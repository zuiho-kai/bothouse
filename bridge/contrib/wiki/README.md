# 每个角色一个 wiki + 夜间反思（作者本机原样搬运）

这里是作者本机正在跑的那套，代码没重写，只把写死的路径、角色名、频道 ID 改成了参数/配置：

- `bin/ingest.py`：会话结束后把新内容整理进 wiki；`--nightly` 夜里补漏、审查、做 dream（今日反思、规则候选，
  引文逐字核对用户原话）；`--lint` 每周体检。依赖同目录的 `sessionlog.py`、`daypack.py`、`codex_daypack.py`、
  `lint.py`、`search.py`。
- `bin/teammate/`：sub 角色 wiki 里的 `bin/ingest.py` / `lint.py` / `search.py` 转发壳，转到共享的 `bin/`。
- `export.py`：把 sub 角色（Codex / Antigravity / DSH）的会话和日记转成 ingest 读的转录。
- `sub-wiki.sh`：sub 角色的触发入口（pending / nightly / lint / cc-connect `agent.closed` 钩子）。
- `setup_wiki.py`：给每个 sub 角色建一本自己的 wiki（从 llm-wiki 模板克隆）。

## 安装（和作者本机一样：gate + wiki 都装）

1. 装 gate（`../gate`，见 `gate.py` 开头），团队文件 `gate-team.json`。
2. 主角色 wiki：把 llm-wiki 模板放到 `~/wiki`，把本目录 `bin/*.py` 复制到 `~/wiki/bin/`（`teammate/` 一起）。
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
   command = "/bin/zsh -f <本目录>/sub-wiki.sh hook"
   ```

4. 定时（作者本机用 launchd，这里换成 cc-connect cron；`--exec` 的输出会发到该会话，`--silent` 不发）：

   ```sh
   S="--project <主角色项目> --session-key <会话 key> --silent"
   cc-connect cron add $S --cron "*/30 * * * *" --exec "python3 -I ~/wiki/bin/ingest.py --pending; zsh -f <本目录>/sub-wiki.sh pending" --desc "wiki ingest"
   cc-connect cron add $S --cron "0 3 * * 1-6"  --exec "python3 -I ~/wiki/bin/ingest.py --nightly; zsh -f <本目录>/sub-wiki.sh nightly" --desc "wiki nightly + 反思"
   cc-connect cron add $S --cron "0 3 * * 0"    --exec "python3 -I ~/wiki/bin/ingest.py --lint; zsh -f <本目录>/sub-wiki.sh lint" --desc "wiki weekly lint"
   ```

环境变量：`WIKI_DIR`（主 wiki，默认 `~/wiki`）、`WIKI_BIN`（共享工具目录，默认 `~/wiki/bin`）、`WIKI_BOTS`、
`WIKI_TRANSCRIPTS`（转录输出，默认本目录 `transcripts/`）、`WIKI_PYTHON`、`AGENT_ROLE`、`LLM_WIKI_SRC`。
模型引擎（haiku / sonnet / codex …）在 config.json 的 `*_engine` 键改。
