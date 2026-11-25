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

## PR 引用与状态

整理、夜间复核和维护保留有来源的症状、根因、修法及仓库和 PR 编号等稳定引用。
PR 开放或合并、任务进度、检查数量和部署进度不作为长期现状写入正文、页面描述或目录；
给旧状态补日期仍不能保证它下次被读取时有效。需要当前状态时再用权威入口查询，例如
`gh pr view <编号> --repo <owner/repo> --json state,mergedAt,url`；合并状态不能代替部署证据。
整理本身不新增 GitHub 查询依赖，也不把未查询或查询失败当成未合并。
已有相关页面由后续整理按同一规则更新，旧事实块通过无损更新契约保留原始来源；
夜间复核旧会话不会据此把当时的状态恢复为当前现状，仍遵守当天可修改页面的范围。
无损更新计划从当前冻结块目录选择整数编号，程序再精确映射到已有块 ID；
模型不再重抄长哈希。保存候选仍使用原始 ID，恢复时重新读取目录编号，
未知编号、损坏的旧 ID、来源引文不匹配仍会拒绝交付。

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
   {"assistant": "协调员", "bots": {"协调员": ["协调员"], "码农": ["码农"], "笔杆": ["笔杆"]},
    "user_names": ["你的群昵称"], "rule_files": ["~/.claude/CLAUDE.md"],
    "dream_notify": "<cc-connect 项目> <会话 key，如 discord:频道ID>"}
   ```

   可用键见 `bin/ingest.py` 的 `DEFAULTS`；会话来源默认是本机 Claude Code 日志，角色名用环境变量
   `AGENT_ROLE`（和 `assistant` 一致），更多来源写 `sources.json`（见 `sessionlog.py` 开头）。
   Claude Code 的 SessionEnd hook：`python3 -I ~/wiki/bin/ingest.py --hook`。
3. sub 角色：`cp bots.example.json bots.json` 填好各角色（或用 `WIKI_BOTS` 指到别处），然后
   `LLM_WIKI_SRC=<llm-wiki 路径或 git 地址> WIKI_LEAD=协调员 WIKI_USER=你的群昵称 python3 setup_wiki.py coder writer`。
   cc-connect 配 `agent.closed` 钩子：

   ```toml
   [[hooks]]
   event = "agent.closed"
   type = "command"
   command = "python3 -X utf8 -I <本目录>/sub-wiki.py hook"                 # Mac / Linux
   # command = "& python -X utf8 -I '<本目录>\\sub-wiki.py' hook"           # Windows（PowerShell）
   ```

4. 定时：向导（网页或 `cc-connect setup apply`）只在主 wiki（`~/wiki` 或 `$WIKI_DIR`）是向导自己建的、
   里面有 `.bothouse-main` 标记时，才自动加好下面三条 wiki 静音任务（跑 `ingest.py` 和 sub 角色的整理），
   向导里选的三项模型也只写进这本 wiki 的 `config.json`。任务挂在主角色上：Discord / 飞书挂默认频道，
   cloud_web 没有固定房间，挂在 `cloud_web:wiki` 这个会话上（静音任务不发消息，所以不需要真房间）。
   重跑不会重复；同名任务已经有了就不动。
   向导还会为记忆论坛增加两条静音任务：每分钟运行一次 `gate/reflector.py`，处理已结束轮次的反思和代码地图；
   每天 05:30 运行 `gate/score_night.py`，按用户后续反馈写外部结果票。两者复用记忆论坛现有推送记录和投票文件。
   主 wiki 是你自己原有的（没有 `.bothouse-main`）时，向导只查不写：不写它的 `config.json`，不挂 `ingest.py`；
   有 sub 角色 wiki 时只挂 sub 角色那部分（`sub-wiki.py`），没有就一条都不挂。这时要整理你自己的 wiki，
   按下面的命令手动加（`--exec` 的输出默认会发到该会话，`--mute` 什么都不发）：

   ```sh
   S="--project <主角色项目> --session-key <会话 key> --mute"
   cc-connect cron add $S --cron "*/30 * * * *" --exec "python3 -I ~/wiki/bin/ingest.py --pending; sh <本目录>/sub-wiki.sh pending" --desc "wiki ingest"
   cc-connect cron add $S --cron "0 3 * * 1-6"  --exec "python3 -I ~/wiki/bin/ingest.py --nightly; sh <本目录>/sub-wiki.sh nightly" --desc "wiki nightly + 反思"
   cc-connect cron add $S --cron "0 3 * * 0"    --exec "python3 -I ~/wiki/bin/ingest.py --lint; sh <本目录>/sub-wiki.sh lint" --desc "wiki weekly lint"
   cc-connect cron add $S --cron "* * * * *" --exec "GATE_DEFAULT_BOT=<主角色项目> GATE_WIKI=~/wiki CODEMAP_DIR=~/.bothouse/codemaps python3 -I ~/.bothouse/gate/reflector.py" --desc "记忆论坛每轮反思"
   cc-connect cron add $S --cron "30 5 * * *" --exec "GATE_DEFAULT_BOT=<主角色项目> GATE_WIKI=~/wiki python3 -I ~/.bothouse/gate/score_night.py" --desc "记忆论坛夜间结算"
   ```

`--pending` 在原有路线每次只整理一个现有大小的批次，剩余会话和运行中收到的关闭提示留到下一次触发；
超长单条记录按已验收片段续办，全部片段通过后才推进会话字节偏移。LOSSLESS 等验收照常执行。
切段后的助手／工具内容也必须验收；所有整理入口达到既有失败次数时只告警、保留待办，不再跳过内容。
持续失败的首批会留待重试和处理告警，不能靠伪造已读位置让队列前进。

白天选择 `codex` 或 `openai:high` 时使用提案路线：小会话在既有 `MAX_CHARS` 上限内合批，
程序提取事实、检索页面、校验操作并写入，每个会话都有独立日志与已读位置。首次事实提取结果按会话保存在
`.ingest-propose/facts/`（含会话内容，只存本机：模板 `.gitignore` 与已装 wiki 的 `.git/info/exclude` 都忽略它，
超过两天的自动清掉）；操作或验收失败后复用它，只重做放置，原话仍重新核验。失败过的批次下一轮按原有规则减半重试，
拆出来的会话仍用各自保存的提取结果。
验收的原话核对在写入前逐行先做一遍：不过的那条操作连同原因退回模型改一次，再不过只把这条事实记进日志的未写入清单，
同批其他事实照常写入。修正请求只含被拒事实；模型漏给去处、会话编号写错的事实同样进日志，不丢。
队友转述的用户要求照常记：引文须是能核对到的用户原话，行尾由程序标 `｜源：转述 · <名字>`。
写入前沿用原来的过时检测，被明确取代的旧行原样移进同页历史节。
`openai` 路线可在一轮并发预取多个批次，写入与验收串行；其余路线的待办轮仍限一个批次。
中转站无法服务时本轮停止，不增加失败次数、不退回其他收费路线。
`openai` 路线离任务期限不够再发一次调用时，按期限已到处理：这一批不计失败，本轮不再开始新批次，夜间其余步骤照常。
`api_base`、`api_model`、`api_key_file` 缺项是配置错误：这一批记一次失败并告警，不当作中转站故障。

提案接口需配置四项：`api_base`（兼容接口地址）、`api_model`（服务端模型名）、
`api_key_file`（凭据文件路径）、`api_concurrency`（并发数，默认沿用六路实测设置）。
推理强度复用已有的 `ingest_engine`，例如 `openai:high`，不再新增独立的 `api_effort`；
旧配置的该字段仍能读取，未带强度的旧引擎名会在内存中迁移，不改写配置文件。

`devin:<模型>`（例如 `devin:swe-2-flash-high`，不写模型时用 `swe-2-flash-high`）也走提案路线：两次无工具调用交给本机
Devin 命令行的打印模式（独立进程，不占后台守护进程），回复按同一份 JSON Schema 校验。Devin 的请求限速按整个账号算、
不分模型；被限时按报错里的恢复时间等一次，剩余时间不够或再次被限就本轮停止，不计失败、不退回其他收费路线。
这条路线的待办轮和其他非 `openai` 路线一样一次一个批次。

cron / timer 的 shell 任务超时会取消其所属子进程；Mac / Linux 使用独立进程组，Windows 使用现有的
`taskkill /T /F`。升级前已经脱离父进程的整理任务不会被新版自动接管，须先核对归属并保存现场再恢复。

调度器把本次任务的原有绝对期限通过运行环境 `CC_JOB_DEADLINE` 传给 shell 子进程；没有时限的任务不继承旧期限。
角色导出、整理模型与 Git 同步共用剩余预算，不从每个子步骤重新计时，不修改任务的 `timeout_mins`。
整理在硬期限前预留现有的两秒子进程收尾等待；模型超时后先回收本次调用的后代，再走原有失败回滚。
预算耗尽不增加模型失败次数，不推进未接受内容的偏移或片段检查点；已接受的本地提交保留，未推送的下轮再同步。
`WIKI_STOP_AT` 保持批次之间停止的软期限语义，不打断正在执行的一批；硬期限仍由调度器约束。
这些运行环境由现有入口传递，无需另配定时任务或延长 90 分钟时限。
升级前装的调度器不传 `CC_JOB_DEADLINE`：这时的角色 wiki 入口按该任务现有的外层时限自设一个兜底窗口
（白天 `pending` 90 分钟，`nightly` / `lint` 30 分钟，与 jobs.json 里这三类任务的 `timeout_mins` 一致），
写回 `CC_JOB_DEADLINE` 让整理子进程和每次模型调用共用同一个期限；调度器明确传空串（本身无时限的任务）
仍保持无时限，`WIKI_STOP_AT` 的软停止语义也不变。
等 wiki 的 `.ingest.lock` 也用同一份剩余预算（`export.py` 的 `lock_or_busy`）：白天 `--no-wait` 只问一次，
夜里 `nightly` / `lint` 反复试到预算用完为止，到点这一轮返回失败（结果里 `busy` 和 `failed`，日志写一行），
抢锁前和抢到后都检查期限，最后一次等待不超过实际剩余时间；等锁到点时还没读写任何东西，
会话偏移和 `pending_parts` 保持原样，下一次触发接着做。父层 `budget.run` 若先超时，完成子树回收后
也按导出失败返回，不把预算超时异常传入 `main()`；夜间入口仍沿用原来的退出码 0，失败原因在日志里。
旁边的 `llmwiki` 还是旧版、没有 `budget.py` 时，也优先使用 `CC_JOB_DEADLINE` 的绝对期限，空串仍为不限时；
只有变量缺失才按上面夜间任务的 30 分钟初始化一次，并写回环境给本轮所有角色共用，不为每把锁重新计时。

环境变量：`WIKI_DIR`（主 wiki，默认 `~/wiki`）、`WIKI_BIN`（共享工具目录，默认 `~/wiki/bin`）、`WIKI_BOTS`、
`WIKI_TRANSCRIPTS`（转录输出，默认本目录 `transcripts/`）、`WIKI_PYTHON`、`AGENT_ROLE`、`LLM_WIKI_SRC`。
模型引擎（haiku / sonnet / codex …）在向导里选，或在 config.json 的 `*_engine` 键改。
Claude 短名由 wiki 固定解析：haiku → claude-haiku-5-5，sonnet → claude-sonnet-5-5，opus → claude-opus-5-5；
也可直接填写完整的 Claude 模型 ID（例如 claude-haiku-4-5-20251001），`claude` 引擎读取 `WIKI_CLAUDE_MODEL`（默认 sonnet）。
CLI 与 api-* 引擎共用这套解析，不修改用户的全局 Claude 设置。返回的 modelUsage 必须只包含请求的确切 ID；
不符或成功回执缺少模型信息时，记录已报告的实际用量、撤回本批并报错退出，不继续模型兜底或交付该批。

角色夜间入口同时运行各本 wiki，使用独立 Git、锁和断点；夜间优先处理较旧会话，
白天仍可用 `WIKI_NEWEST_FIRST=1` 优先最近会话。每个模型初次调用失败后最多再重试三次，
每次先恢复本轮开始的文件状态，再发起新会话；三次仍失败才换下一个模型。
默认 Codex 顺序为 Luna、Sol，再走 `after_codex` 的 Antigravity、Haiku；
429、额度拒绝、连接中断和模型报错采用同一规则，剩余时间不足时保留待办。
修正轮和后续材料轮重试保留此前成功轮次的输出，失败会话不被复用。

各角色可分别选不同主引擎以分担额度，例如一份使用 `ingest_engine: "codex:high"`，
另一份使用 `ingest_engine: "agy"` 和 `agy_model: "gemini-4-hydrogen-medium"`。
夜间等其他阶段各自使用对应的 `*_engine` 键，安装时也可通过 `WIKI_ENGINES` JSON 写入。
`WIKI_AGY_MODEL` 可临时覆盖模型；命令不在 PATH 时用 `agy_cmd` 或 `WIKI_AGY_CMD`
指定可执行文件的绝对路径，默认仍为 `agy`。模型和可执行程序须由本机安装提供。
向导创建的角色库默认仅在本机保存；未配置远端时无需拉取，仍照常整理并提交到本地 Git。
论坛任务可用 `GATE_DEFAULT_BOT`、`GATE_WIKI`、`CODEMAP_DIR` 指定默认角色、Wiki 和地图目录；
`WIKI_CODEX_MODEL` / `REFLECTOR_MODEL` 可分别指定夜间结算和反思任务的模型，未设置时使用 Codex CLI 的配置模型；
`CODEX_SESSIONS_DIR` / `CLAUDE_PROJECTS_DIR`
指定读取原生会话记录的位置，`CODEMAP_FILL_SCRIPT` 指定地图回填脚本。
远端转录镜像由 `WIKI_MIRROR_TO` 指定 SSH 主机别名；默认不启用。接收端路径用 wiki 配置的 `mirror_dir`
设置，默认 `~/.bothouse/wiki-hosts`，按主机名分目录存储。


### 原文块守恒与候选恢复

整理开始前，程序把来源提交、逐块原文和输入转录冻结到本地 Git refs，给模型提供
`.ingest-work/block-sources.json`。模型只返回搬移地址，程序读取原块并执行；接受、交付和
断点恢复都检查原块份数及其在 MEMORY → README 索引链中的可检索位置。拆页不允许改写或增删事实，
追加新事实不能抵消丢失旧块。产品原有嵌套目录、拆域与机械合并继续使用。
原块保留既有换行；接受边界不再自动折行旧正文，新格式错误仍由增量 lint 检查拒绝。

模型返回一行 `Wiki-Blocks: {"moves":[],"updates":[]}`；moves 的每项包含 catalog 中的
block ID、目标主题页 to 和已有 H2 标题 section。updates 还须包含一个完整替代块 text、
原始输入的精确行号和原句 source、明确取代关系 reason。该契约检查字面覆盖和来源，不能证明自然语言真实性。

显式事实替换默认自动推进：仍须逐条核对冻结输入的原句、明确取代关系、完整最终树和原块份数，
合法更新与同批新增事实一起交付并推进断点。自动模式不生成或伪造人工审核回执。
需要人工批准时，在这本 wiki 的 `config.json` 设置 `"fact_update_review": true`（默认 `false`）。
人工模式保存待审候选，不推进断点、不增加失败计数，等待期间不重复调用模型；日志给出 candidate SHA。
独立审核者可用以下入口查看完整来源和提案，再决定是否批准：

```sh
python3 -I bin/block_contract.py show --repo /path/to/wiki --candidate <SHA>
python3 -I bin/block_contract.py approve --repo /path/to/wiki --candidate <SHA> --reviewer <name> --reason <review-result>
```

审核回执绑定来源、输入、搬移计划和完整最终树；候选或主库改变后需要重新审核。模型整理进程
（WIKI_INGEST）不能调用批准入口。回执是本机人工审核记录，不是操作系统级身份隔离。
下次同一批次进入普通整理时恢复候选，按当前配置重新接受与交付；旧版强制审批留下的候选
也能在默认自动模式恢复，不重复调用模型。交付提交固定记录当时的审批策略，SQLite 断点恢复
使用该记录，不受之后切换模式影响；缺少策略的旧交付仍按原来的强制审批契约验证。

候选 refs 是输出，不会再次加入搬移前的来源清单；主库前进只增加新的主库来源并合并候选。
文本冲突时两侧保留，日志标明 pending，留给维护者处理，不能当作已交付。
失败回退、重启同步或交付冲突需要换工作树时，程序通过 Git 把旧树移到
`.ingest-archives/<唯一目录>/worktree`，保留 HEAD、暂存区、未跟踪文件及忽略的原块证据，
再创建干净工作树，不清空旧目录。日志给出保留位置；归档不参与断点恢复或自动充当原块来源，
创建新工作树失败时原候选仍保留，下次同步可继续。归档不自动清理，维护者须按本机删除规则处理。
交付提交记录同批次的完整/分片进度；Git 成功而 SQLite 尚未写入时，下次 state 装载先验证契约再恢复断点。
所有来源、候选和回执保留在对应 wiki 内，不随软件代码推送。
