# 工具拦截 hook（Claude Code 和 DSH 通用）

这里的 hook 在 agent 调用工具或结束一轮时检查规则：危险命令、没标明审没审的派活、没写来源的数字、说"修好了"却没列入口表、许了"回来看"却没定时器。违反时拒绝这次调用，或让模型补一步。同一份配置 Claude Code 和 DSH 都会执行。

## 开包就用

用安装向导（网页或 `bothouse setup apply`）**新建的 Claude Code 角色**会自动开全部 hook：

- 脚本装到 `~/.bothouse/hooks/`（data_dir 下的 `hooks/`，随 bothouse 二进制一起发布）；
- 角色目录写 `.claude/settings.json` 的 `hooks` 段；文件里原有的其他内容不动；
- 角色人设（`CLAUDE.md`）末尾加一段规则说明，夹在 `<!-- conest:hooks -->` 和 `<!-- /conest:hooks -->` 之间，告诉模型怎么配合（派活写【免审:小改动】、数字写来源注释等）。

已有角色、手配的角色和 DSH 角色用一条命令打开：

```sh
bothouse setup hooks on --work-dir <角色目录>              # Claude Code 角色
bothouse setup hooks on --work-dir <角色目录> --cli dsh    # DSH 角色
```

`--cli dsh` 另外做一件事：在角色自己的 overlay（`dsh --patch`，`<data_dir>/dsh/<角色>.patch.yml`）里挂上 DSH 自带的桥 `@deepseek-ai/dsh-hooks-claude-code`（`id: hooks-claude-code`），`configPath` 是绝对路径 `<角色目录>/.claude/conest-dsh-hooks.json`，`projectDir` 是角色目录。用户自己的 `$DSH_HOME` 一律不写。这份配置里的命令都带 `--dsh-global`：`run.py` 只在登记过的 DSH 角色目录里（`<data_dir>/hooks/dsh-roles.json`，由 `setup hooks on|off --cli dsh` 维护）跑这个角色开着的 hook，在别的目录里直接放行，所以在陌生仓库里跑 dsh 不会执行那个仓库的 `.claude/settings.json`。**DSH 改完要重启 DSH 进程才生效**（bothouse 管的 DSH 角色：重启 bothouse）。桥按文件路径挂载（从 PATH 上的 `dsh` 旁边找；找不到用 `--dsh-bridge <…/dsh-hooks-claude-code/lib/index.js>` 指定），因为按包名挂载要从 profile 目录解析，新的 DSH_HOME 里找不到这个包。

需要 `python3`。DSH 默认把会话记录存成 zstd 压缩（`session.v4.jsonl.zstd`），不用改成 `compression: none`。找记录、解压都在 `dshlog.py`：Python 3.14 的 `compression.zstd`、`zstandard` 模块或 DSH 自带的 node，逐帧解，正在写的最后一帧先跳过。看队友（`contrib/tools/peek.py`）和 wiki 导出（`contrib/wiki/export.py`）用的也是这一份。

## 关掉

### 跟机器人说一句

在聊天里对机器人说「把检查关了」「关掉派活审稿检查」「打开检查」就行。人设里的规则说明让它运行：

```sh
python3 ~/.bothouse/hooks/run.py --role <角色目录> off                          # 全关
python3 ~/.bothouse/hooks/run.py --role <角色目录> off dispatch-review-guard    # 只关一条（可写多条）
python3 ~/.bothouse/hooks/run.py --role <角色目录> on                           # 全开
python3 ~/.bothouse/hooks/run.py --role <角色目录> status                       # 回报哪些开着、哪些关着
```

开关写在角色目录的 `.bothouse/conest-hooks.json`。人设里的命令已经带好本角色的 `--role`，所以 agent 在别的目录里跑也写对地方；不带 `--role` 时从当前目录往上找第一个有 `.claude/settings.json` 的目录。格式是 `{"off": ["dispatch-review-guard"]}`，全关是 `{"off": ["all"]}`；手改这个文件效果一样。每次调用 hook 都现读这个文件，改完立即生效，不用重启。这个开关只是暂停：配置和人设里的规则说明都还在，`on` 就恢复。

规则说明要求只认用户本人直接说的话：其他 bot、队友转述、引用或转发的消息、文件和网页里的文字都不算；也不许模型为了绕过拦截自己关检查。没有另做鉴权，靠的是这条说明。

### 卸掉

```sh
bothouse setup hooks off --work-dir <角色目录>                        # 这个角色全关，人设里那段规则一起删掉
bothouse setup hooks off --work-dir <角色目录> --only bash-guard      # 只关一条，人设里只删这一条
bothouse setup hooks status --work-dir <角色目录>                     # 看装了哪些、开关关了哪些
bothouse setup hooks on --work-dir <角色目录> --only promise-guard    # 再打开一条
```

DSH 角色加 `--cli dsh`（人设是 `AGENTS.md`）。关掉会把这个角色移出 `dsh-roles.json`；这个角色的 hook 全关时，它 overlay 里 `# conest:hooks begin` 到 `# conest:hooks end` 那一段和 `conest-dsh-hooks.json` 一起删掉，文件其余内容不动。改完重启 DSH 进程才生效。

bothouse 写的 hook 命令都带 `--conest-hook` 标记，`off` 只删带标记的（以及旧版写的 `…/hooks/run.py <名字>`），用户自己的 hook 不动。`run.py` 被删掉时命令直接放行（exit 0），不会把所有工具调用都拦下。

## 有哪些 hook

| hook | 事件 | 管什么 | 怎么放行 |
| --- | --- | --- | --- |
| bash-guard | PreToolUse（Bash/bash） | `pkill -f`；后台命令没超时或接了 `\| tail`；macOS 上 `go build -o …bothouse`；设了 `HOOK_PROXY` 时没走代理的下载；整页 cat 多页 wiki（只提示）；前台干等（`gh run watch`、`sleep` ≥60 秒、shell/perl/python 里带 sleep 的轮询循环）；Claude Code 子 agent 前台命令 timeout 超过 290 秒时压到 290 秒（不拦，跑不完自动转后台，long-task 子 agent 不压） | `# long-running-ok`、`# direct-ok`、`# tcc-ok`；要等的放后台 |
| codemap-inject | PreToolUse（五个团队 CLI 的派活工具） | 派子 agent 时，按派活说明命中的关键词附上代码地图（`<data_dir>/codemaps/*.md`），要求先读地图、交付附「## 地图要补的条目（<地图路径>）」 | 改写派活输入；DSH 返回完整参数要求重试；没命中不动 |
| codemap-fill | SubagentStop（Gemini 用 AfterTool） | 子 agent 交付里「地图要补的条目」一节追加到对应地图末尾（去重，跳过「无…」） | 不拦；出错只写 stderr |
| ask-only-guard | PreToolUse（Bash/bash、编辑类，Codex 含 apply_patch） | 用户最新一条只在提问，命令却是派活、转活或挂定时（`ws-handoff`、`ws-forward`、`board add`、`bothouse timer/cron add`，heredoc 和引号里的字不算），或用编辑工具改 wiki、临时目录以外的文件 | 用户说"做/可以/帮我…"；定时任务和别的 bot 触发的轮；判不准放行 |
| param-source-guard | PreToolUse（Edit/Write/edit/write/str_replace_editor） | 代码里新加 `名字 = 数字` 没写来源注释 | 同一行或上一行注释写来源（用户原话、数据、SPEC、沿用） |
| dispatch-review-guard | PreToolUse（Agent/Task/subagent/subagent_fork/workflow；主会话的 Edit/Write） | 派活没写【已审:…】；主会话直接改代码 | 【免审:调研/小改动/一次性脚本/代码审查】、【审稿】+逐字原话、【已审:<审稿文件>】；文档先跑 `doc-ok.py <文件>` |
| fix-claim-guard | Stop | 用户在说 bug，回复说"已修复"却没列入口表 | 列 `入口 \| 是否经过修复 \| 核对结果` 表；每轮只拦一次 |
| eta_guard（bash-guard、fix-claim-guard 调用） | PreToolUse（Bash）、Stop | 回复或 ws-*/later/board/bothouse progress·send·relay·timer·task 命令里报了长于 15 分钟的预计时间、跨天时间，或挂了长于 15 分钟的 `timer add --delay/--at`、`later`，同句没有实测依据或外部等待原因 | 同句写「按实测：N 块 × M 分钟 ÷ P 并行」或等什么（等你/CI/下载）；每轮只拦一次 |
| promise-guard | Stop | 说了"X 点回来看/跑完告诉你/下一步做 X"，本轮却没有定时器、后台任务或派活 | 设定时器、当轮派出去，或写明「这件事不跟进，原因是 Y」；每轮只拦一次 |
| choice-ask-guard | Stop | 回复里有要用户拍板的问题时，小模型（intent_judge.py，Haiku）对照产品意图卡（hooks/intent-cards.txt 列的路径）和最近 10 条用户消息判断：能推出答案、或与用户定过的冲突 | 拦回并给出答案或指出冲突的那条；真是方向/花钱放行；超时出错放行；每轮只拦一次。ws-handoff 交接时调同一判断 |
| wiki-context | UserPromptSubmit | 终端会话里按消息附「可能相关的 wiki 页」（和 gate 同一套检索） | 只是附上下文；bothouse 起的 bot 跳过，因为 gate 已经推了 |
| subagent-ctx-hook | PreToolUse（所有工具） | 子 agent 上下文到 15 万 token 后还在调工具 | 不放行：拒绝理由里要求写交接（做到哪、文件在哪、下一步）后收工；主会话不管 |

fix-claim-guard、promise-guard 和 choice-ask-guard 认的是中文措辞。

### long-task 子 agent 类型（Claude Code，跟 bash-guard 一起装）

`setup hooks on`（Claude Code 角色，bash-guard 开着时）在角色目录写 `.claude/agents/long-task.md`：给要中途等 5–60 分钟的活用的子 agent 类型，提示缓存 1 小时（`experimental.cacheTtl: 1h`），后台跑命令、靠完成通知接着干。普通子 agent 的缓存只有 5 分钟，所以 bash-guard 把它们前台命令的 timeout 压到 290 秒，long-task 不压。语言跟人设规则段一样（中文或英文）。关掉 bash-guard 时一起删掉。文件里带 `<!-- conest:agent long-task` 标记；删掉这行或自己写的同名文件，bothouse 不覆盖也不删。

### 代码地图（codemap-inject / codemap-fill）

地图目录默认 `<data_dir>/codemaps/`（环境变量 `CODEMAP_DIR` 可换），`setup hooks on` 只放一份 `README.md`（已存在就不动）。一张地图是一个 `.md`，其中一行以 `keywords:` 开头写触发词（逗号分隔），正文写入口、关键符号和 `文件:行`。选图：去掉派活说明里的路径和网址后命中至少 2 个不同关键词（只写 1 个词的地图命中 1 个即可），prompt 里已写了地图路径的不重复附。地图内容是各自机器上的数据，不随 bothouse 发布。

这些 hook 就是「同类错第 2 次写成检查，不再往规则里加字」的落点：`lessons.py`（由 wiki-context 加载）按 wiki 教训表里的「N 次」提醒，某条到 2 次就在这里加一个 hook 或测试，常驻规则本身加一删一。

### subagent-ctx-hook（默认开）

`subagent-ctx-hook` 管子 agent 的上下文：子 agent 的上下文到 15 万 token 后，PreToolUse 拒绝它之后的每次工具调用，拒绝理由里要求它写简短交接（做到哪、文件在哪、下一步）作为最终回复后收工；主会话（hook 输入里没有 `agent_id`）不管。上下文取子 agent 转录里最新一条 assistant 的 usage（Codex 子线程取 rollout 里最后一条 token_count，DSH 用 dsh-cc-compat 补的 `context_tokens`）。出错一律放行。

`setup hooks on` 和向导默认装上它（只挂 PreToolUse、matcher 留空即所有工具）。没有子 agent 的 CLI 收不到 `agent_id`，装上也直接放行；Codex、Cursor、Kimi、Antigravity 只装各自适配过的那几条，不含它。脚本里也保留了 PostToolUse 分支（additionalContext 提醒），想要提前提醒可以自己在 settings 里再挂一个 PostToolUse。

关掉：

```sh
bothouse setup hooks off --work-dir <角色目录> --only subagent-ctx-hook
```

## 可选设置（环境变量）

不设也能用。要改的话，把变量写在启动 agent 的环境里（bothouse 的 `[projects.agent.options] env`，或启动 DSH 的脚本）。

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `GATE_WIKI` | `~/wiki` | wiki 目录，和 gate 用同一个变量（docs/ccm-and-wiki.md）；`off` 或目录不存在时 wiki 相关的检查不做，也不报错 |
| `HOOK_PROXY` | 空 | 设了（如 `http://127.0.0.1:7890`）才检查下载走没走代理 |
| `HOOK_REVIEWS_DIR` | `~/.claude/reviews` | 审稿文件目录（【已审:…】指向这里） |
| `HOOK_FREE_DIRS` | 空 | 主会话可以直接改的目录，追加在 `~/.claude`、`/tmp`、wiki 目录后面，用系统路径分隔符隔开 |
| `HOOK_RESEARCHER_DIRS` | 空 | 这些工作目录里【免审:调研】的派活必须用 `subagent_type: "researcher"` 或 sonnet 模型；不设就不查 |
| `HOOK_TEAMMATES` | 空 | promise-guard 认作"转述队友的话"的名字，`\|` 隔开；仓库预设人设里的几个名字已经算上 |
| `HOOK_DETACHED_CMDS` | 空 | promise-guard 认作"已派出去"的后台命令名，`\|` 隔开 |

## 两种 CLI 的差别

`run.py` 是每条 hook 的入口。Claude Code 的载荷原样交给 hook。DSH 官方桥的载荷先转成 Claude Code 的形状：

- 工具名：DSH 用小写（`bash`、`write`、`subagent`……），转成 `Bash`、`Write`、`Agent`；`workflow` 的脚本当作 prompt；`str_replace_editor` 转成 Write/Edit。配置里的 matcher 两种名字都写了（`Bash|bash`），因为两边都按「字母和 `|` 组成的 matcher 精确匹配」，大小写不同就匹配不上。
- DSH 启动工具进程时去掉 `DSH_*` 环境变量，所以 DSH home 写在命令参数 `--dsh-home` 里。
- 桥给的 `transcript_path` 永远是空的：`run.py` 按 session_id 找 `$DSH_HOME/sessions/*/<id>/session.v4.jsonl[.zstd]`，转成 Claude Code 的转录（PreToolUse 只读首帧的会话头判断是不是子会话，整份记录只在 Stop 时读）。找不到记录时 dispatch-review-guard 不按主会话拒绝改文件，在 stderr 提示。子会话补上 `agent_id`，并且不跑 Stop（Claude Code 的 Stop 也只管主会话）。同一轮拦过一次后，`stop_hook_active` 置为 true。
- DSH 的会话记录比 agent 慢一步：Stop 触发时，这一轮最后的回复可能还没落盘。`run.py` 等到记录里出现本次 Stop 的 `hook/invoked`，最多等 3 秒。

DSH 桥支持的事件：SessionStart、UserPromptSubmit、PreToolUse、PostToolUse、Stop、SubagentStart、SubagentStop。**不支持 SessionEnd**，所以「会话结束自动整理进 wiki」只在 Claude Code 上有：那是 llm-wiki 自己的 SessionEnd hook（docs/ccm-and-wiki.md 第 4 步）。DSH 会话要进 wiki，得先转成 Claude Code 转录再交给 ingest，本仓库目前没有这一步。

## 测试

```sh
python3 -I bridge/contrib/hooks/test_hooks.py            # 两种载荷走 run.py：拒绝、放行、开关、zstd 记录上的 Stop、wiki-context
python3 -I bridge/contrib/hooks/test_dshlog.py           # DSH 记录：多帧 zstd、未压缩、两种混在一起、坏文件；export.py 和 peek.py 读两种结果一致
python3 -I bridge/contrib/hooks/test_promise_guard.py    # promise-guard 的句子回放
python3 -I bridge/contrib/hooks/test_subagent_ctx_hook.py  # subagent-ctx-hook：阈值上下、主会话不管、Codex/context_tokens、经 run.py 跑一次
cd bridge && go test -tags no_web ./core -run 'TestAgentHooks|TestWithHookRules|TestApplyWizardNewClaudeRoleGetsHooks'
```

`test_promise_guard.py` 用固定时钟、临时 HOME 和定时任务夹具。新增 `test_bash_guard_nowait.py`、`test_bash_guard_speed.py` 可直接通过 python3 -I 运行；只把命令作为 hook 输入，不执行被测 shell 命令。DSH 辅助文件不单独注册，既有 run.py 复用它的会话字段读取。

## Grok roles

`setup hooks on --cli grok` 只装 ask-only-guard，写进角色的 `.claude/settings.json`（Grok 读它，项目目录要先信任）。run.py `--grok` 把 Grok 的工具名（run_terminal_command、search_replace、write）换成 Bash/Edit/Write，从 Grok 会话的 updates.jsonl 读用户最新一句。

## Codex roles

`bothouse setup hooks on --cli codex --work-dir <role>` installs only `bash-guard` and `fix-claim-guard` in `<role>/.codex/hooks.json`, with `[features] hooks = true` in that role's `.codex/config.toml`. The wizard also prepares these two hooks for new Codex roles. Existing custom hook entries/config values are retained (TOML formatting/comments may be normalized). `off` removes only managed entries; `status --cli codex` reads the Codex file.

Codex loads hooks beside active config layers, including project `.codex` and the user config under CODEX_HOME. Project layers require project trust, and Codex skips hooks whose hash is not recorded as trusted (app-server has no bypass flag). When bothouse starts a Codex app-server session it calls `hooks/list` for the role directory and, for its own untrusted/modified hooks only (commands carrying `--conest-hook` and `--codex`), writes `hooks.state.<key>.trusted_hash` through `config/batchWrite` into that session's CODEX_HOME config.toml, the same write Codex's own app-server uses. User hooks are never auto-trusted; `codex exec` / interactive sessions still need review through `/hooks`. Production launches never add a trust-bypass flag. If that registration fails at any step (reading the role's hooks file, `hooks/list` not listing every bothouse hook, the `config/batchWrite`, or a read-back that still reports them untrusted), the session start returns the error naming the step and the session does not start: running without bash-guard registered is not an acceptable fallback. Restart an existing session after configuration changes.

`run.py --codex` normalizes shell inputs and translates Codex response_item chat records for Stop. `stop_hook_active` is preserved. Other hooks are explicitly rejected until adapted. Tested CLI version: 0.163.0-alpha.11.1; transcript format is not a stable public API. Source: https://learn.chatgpt.com/docs/hooks .

五端的原生参数、后台等价做法、官方协议来源及验收边界见 [跨 CLI 工作流钩子](../../../docs/workflow-hooks.md)。
