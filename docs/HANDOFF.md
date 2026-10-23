2026-10-23：feat/dsh-ux-chat 在 f8f57ac 上补频道成员错误提示、红色出错状态、模型设置入口、正在输入与忙状态；collab node --test 通过。用户限时交回：手机抽屉代码已补，390px 浏览器验证、截图及设置入口验证未完成，图片和回复引用记入 README 路线图。保留 layout 深链注入；未部署。

# 共栖当前交接

2026-10-23 Issue #86 审核补改：DSH 安装器复用内容相同的恢复副本，拒绝覆盖不同副本；Codex exec 在普通与严格输入路径的进程退出后停止活动子 Agent 行，保留终态和 tracker 通知通道供下一轮复用。两处回归均已验证改前失败、改后通过，目标 race、构建/vet 与两版本 DSH 运行时副本校验通过；最终全量和 CI 见 PR #91。未部署。

2026-10-23 Issue #86：Codex（app_server / exec）与 DSH（ACP 原生生命周期扩展）接入独立子进程表，复用渲染；补齐身份/代次隔离、后台跨轮与关闭状态。适配器回归旧 main 红、实现绿；目标 race、构建/vet 与 DSH 两版本真实运行时副本校验通过。macOS 全量 48 个测试包通过，仅安装向导 TestSetupCLIsHint 失败，改前 main 同样复现。子 Agent 审出旧 turn 完成覆盖新回合、send_input 重派未重开、等待标记未采集三项 P2，已补先红后绿回归修复；最终复审/CI 见 [PR #91](https://github.com/zuiho-kai/bothouse/pull/91)。未部署、未做真实模型/Discord 验收；DSH 需另安装转发层，exec 无跨进程实时事件。用法和边界见[说明](../integrations/dsh-acp-subtasks/README.md)。
2026-10-23：Issue #52，分支 feat/wizard-theme。安装向导增加白底蓝紫强调色的明亮风格，保留黑底荧光绿深色；右上角按钮通过 cc_theme 记住用户选择。Setup 隐藏管理侧栏，新增品牌欢迎区与圆角卡片。前端 lint、7 项 Vitest、构建与沙箱 Go 全量（49 个包）通过；临时 HOME=/tmp/themetest 下构建二进制的真实向导通过 Chromium 桌面/手机检查。截图、配色 wiki 行号和验证说明见 [wizard-theme](verification/wizard-theme.md)，draft PR 与最终验证结果记录在 /tmp/theme/result.md。单一 Agent 实现与自查，未部署、未合并，没有操作发布目录。

2026-10-23：按用户「免审:小改动」在 feat/wizard-dsh-platform 完成 DSH 专用三步向导；已合入 origin/feat/dsh-plugin-pkg。新增 setup dsh [install] 和管理 API，调用 install.sh web --lang，角色配置留在 DSH。保留原有 DSH 智能体功能。隔离 HOME 与 /tmp/wiz-dsh/dsh-home 实装成功，profile 含 collab/UI，locale=zh；测试和最终提交证据见 /tmp/wiz-dsh/result.md。DSH 回归、CUJ、前端 build、vet、浏览器三步验证通过。Go 全量在 core 包长时间无输出，受用户 10 分钟上限中断并保留堆栈，不能宣称全量通过。用户要求只提交推送本分支，不开 PR；未部署。

2026-10-23：按用户「免审:小改动」授权统一下载入口，直接推 main。Mac 用 lipo 合并 arm64/amd64 为 universal，仅发布 bothouse-mac.dmg（Bothouse.app，卷名 Bothouse）；Windows 仅发布 x64 的 bothouse-windows.exe，Linux 为 bothouse-linux-x64 / bothouse-linux-arm64。安装脚本和 CLI/网页共用的更新器认新名，更新器兼容旧架构文件和历史压缩包，校验失败不回退。发布 workflow 同步构建与 smoke；打包脚本拒绝单架构输入。回归先红后绿，沙箱 Go 全量、CUJ、定向回归、vet、actionlint、shell 语法检查、Linux 安装与坏校验拒绝通过。v0.1.2 资产替换、Mac 实际启动与安装/更新提取的最终证据见 /tmp/rename/result4.md；旧资产的逐字节备份在 /tmp/rename/dist-v0.1.2。单一 Agent 实现并自查。

2026-10-22 bothouse v0.1.2 改名与安装包：CLI 帮助、版本、启动消息、网页、安装脚本及当前安装文档统一使用 bothouse；module 与内部包名保留。配置默认 ~/.bothouse，仅当它不存在而旧目录存在时沿用旧目录，不迁移文件。发布产物为双架构 dmg/exe/Linux 裸文件和 SHA256SUMS，自更新先新名后历史名，v0.1.1 资产保持原状。沙箱 Go 全量、CUJ、定向回归、vet、前端构建与 actionlint 通过；目录回归已验证旧逻辑失败、新逻辑通过。额外 promise-guard 回放的两个时间/任务环境相关失败在改前改后相同，未扩大修复。用户明确要求推 main 并打 v0.1.2；发布与安装包验收的最终证据记录在 /tmp/rename/result.md。没有操作生产机器人配置、进程或频道；单一 Agent 实现和自查。

## 2026-10-22：Bothouse 可双击下载（Issue #50）

Release 流程改为 Windows 双架构裸 exe、macOS runner 用 hdiutil 生成双架构 Bothouse.app/dmg、Linux 双架构裸二进制及 SHA256SUMS；旧 cc-connect 压缩包与 checksums.txt 继续发布，供旧更新器使用。安装脚本认新文件，CLI 与网页自更新共用新文件优先、旧名回退和按实际下载名称校验；校验失败不回退。新 dmg 未签名，安装文档提示拖入 Applications、首次右键→打开。

本次 v0.1.1 的六个新文件从 main 历史提交 `681dc9497ae9144d27066ac1336bede9faa029d4` 重新构建（保留原版本源码），通过 gh 补传；不移动 tag、不重建旧资产，正文只改中英文安装段。上传与最终资产核验见 `/tmp/rename/result.md`。新更新逻辑属于本 PR，未回灌进 v0.1.1 历史源码。

本机 no_web 沙箱全量 48 个测试包、CUJ、更新下载与校验回归、目标 vet 通过。把下载顺序恢复为旧名优先的 overlay 后，回归报 legacy archive 被当作 native 接受；修复顺序后通过。两个 dmg 均经新更新器挂载并精确提取原二进制；arm64 dmg 用 open 启动 App，隔离配置下 Chrome 前台进入 /setup，网页与 setup/state API 都是 HTTP 200，不接真实平台或模型。Windows 两架构 PE/机器码及交叉构建已检查；本机无 Wine，Windows --version 和桌面双击未验。macOS 签名／公证未做。单一 Codex 实现和自查，无子 Agent、无独立审核；最终 main commit、CI、下载到 bothouse-trial 的文件及未验项见 result.md。

## 2026-10-22：工具拦截 hook 进仓库（Claude Code + DSH）

作者本机的 hook（bash-guard、param-source-guard、dispatch-review-guard、fix-claim-guard、promise-guard、wiki-context）去掉私人路径后放进 `bridge/contrib/hooks/`，随二进制发布（`embed.go`）。向导新建的 Claude Code 角色默认全开，人设末尾带规则说明；`cc-connect setup hooks on|off|status` 给已有角色和 DSH 角色开关。DSH 通过自带的 `dsh-hooks-claude-code` 桥读同一份 `<work_dir>/.claude/settings.json`。用户在聊天里说「把检查关了/打开检查」，机器人按人设说明运行 `run.py off|on [hook]`，写角色目录的 `.claude/conest-hooks.json`，立即生效。说明见 `bridge/contrib/hooks/README.md`。验收：干净 HOME 里向导建 Claude Code 角色、命令开 DSH 角色；真实 DSH（假模型）里 pkill、未审派活、无来源数字被拒，【免审:小改动】放行，Stop 在 zstd 记录上拦一次。未部署，作者本机线上 hook 没动。

## 2026-10-22：Issue #13，Discord 连接未就绪时看板维护崩溃

本机部署 main `c96c2ac` 时，Gateway 首次连接 EOF 后重试；十秒后的旧看板清理把 nil `*discordgo.Session` 转成非 nil 的 `boardAPI` 接口，在 discordgo REST 调用里崩溃。已自动回滚原二进制并核验五个桥接心跳及配置、会话、定时任务连续性。

`RemoveBoard` / `UpsertBoard` 复用现有带锁 `boardSession()` 快照，并在接口转换前检查 nil；未连接时返回错误，核心保留原有重试和看板状态。没有禁用看板或增加 panic recover。回归 `TestBoardBeforeConnectionAndAfterStop` 在旧实现报 `panic: runtime error: invalid memory address or nil pointer dereference`，修后通过；另覆盖连接恢复后的真实 Platform→discordgo REST 路径和并发停止（HTTP transport 隔离，不发真实频道消息）。Discord 整包 race、核心 CUJ、目标 vet 和 no_web 全包构建已通过。本机 Go 沙箱全量唯一失败为 `TestSetupCLIsHint`（macOS 固定路径探测到真实 Claude CLI）；用 Go overlay 恢复未修改的生产源码后，单项同样失败。保留原始失败，未改向导、删测或放宽断言；最终 Ubuntu 全量与 CI 结果见 PR。

同一 Codex 实现及自查，没有独立审核。此条只记录源码修复，部署须等待合入 main 后从 main 构建；本机切换结果、备份和真实模型验证边界写入 `/Users/zhaixinyang/yijiazi/docs/HANDOFF.md`。

## 2026-10-21 22:14 JST：龙娘接续 bothouse 软件仓库准备

本分支关联 bothouse #1，同步 conest #8/#9 的自建平台组队修复，并补旧队长点名 ID 改动后的已有队员交回回归。MIT、中英首页、X/B 站脚本草稿转入软件仓库；未带回旧首页存档和不存在的视频，目标／状态／架构按软件定位整理。旧代码里的 3 轮／20 次接力限制早已移除，对外文案已纠正。

Go 全量 47 包、CUJ、目标 vet、Windows 交叉构建、前端构建通过；Camoufox 隔离网页保存两个角色、真实 CLI 增员和重配两次通过。网页与 CLI 仅用测试 hub，不调用真实模型，不接真实频道。原仓库对应补丁另同步到 conest #9。详细证据与未完成项见[核验记录](verification/bothouse-prelaunch-20261021.md)。

仓库保持私有，尚无 Release，新仓库一行安装和真实模型闭环未验；真实 Windows 桌面未验；宣传片等用户看稿后才制作。新增补丁由本龙完成，按协作规则待橘独立验收，不把本轮自查写成最终通过。
2026-10-21 PR #230 CI #387 修复：runner3 的 Node22.23.3/npm10.9.9 使用全新目录和缓存执行 npx vitest@4.1.11，仍复现 Arborist edgesOut 空引用；不是工作目录权限或旧缓存。新增 dsh/package.json 与完整 package-lock，CI 保留 RUNNER_TEMP 每 job 隔离，复制锁文件后 npm ci 并直接调用 Vitest。安装成功后暴露两个测试只等待10次微任务、早于 Response.json 完成的假失败；改为等待明确的频道状态/事件流，保留全部8项断言。原 runner 同版本、空缓存验证锁定安装与8项测试通过，锁文件哈希不变；本机8项与 actionlint 通过。最新 Actions 全量结果以 PR 为准；同一 Codex 自查，未合并、未部署。

2026-10-21 Issue #229 / PR #230 审查修复：gpt-6-astra 对 `dsh/collab/` 的 8 条发现经源码核实后全部处理——DSH 成员 job 记录输入 id，只认领消费该输入的那一轮（网页里同一 Session 的私聊轮次不再外发）；重启恢复撤回未消费输入、按所属轮次补发、不重发，丢失的输入不再卡住队列；消息与 job 同事务写入；恢复与新 @ 共用队列；卸载先停队列再关库；preset scope 全路径释放；提示词窗口始终包含触发消息；`/collab` 断线补齐按连续游标分页。存储 schema v2（jobs.input_id）可从 v1 原地迁移。21 项 node 单测通过；隔离 DSH_HOME + mock LLM 真机复验：回复经输入 id 绑定、v1 库迁移成功。更正：此前记录的「`gate_fallback = "context"` 让没 @ 的消息静默」不成立，没有 gate 时该项不生效，测试 bot 改为 `group_reply_all = false`。另修 CI：vitest 改装到 RUNNER_TEMP 再运行（npx 在仓库根触发 npm arborist 错误）。未部署。

本轮检查补充：仓库 Go 全量没有通过，安装向导测试受宿主 locale 和 macOS 固定位置 CLI 探测影响；清除 locale 覆盖后只剩 `TestSetupCLIsHint`，详见 [验证记录](../dsh/collab/README.md#验证)。bridge 未改，不把该结果记为全绿；PR #230 保持草稿。

2026-10-21 Issue #229 / PR #230 收尾：原生 `client-ui-discord` 已从骨架落地为侧栏「频道」和三栏消息页，支持配置频道切换、成员在线/工作状态、中英与主题、Enter/Shift+Enter/输入法处理。修复订阅生命周期和请求归属、重连分页及实时事件覆盖、发送确认与跨频道草稿归属。前端11项（数据源8+组件3）、后端15项、DSH完整host/client类型检查、插件打包和client package verifier通过；CI加入8项数据源回归。行为回归先红后绿。用户此前确认页面正常，本轮浏览器登录被本地文件URL安全策略阻止，未重新验收；真实DeepSeek回复、gate下自动补历史仍未验。原后台审查仅找到提示词，没有可核实结果；下方“审查进行中”是历史记录。本轮仅自查，无独立review结论，无子Agent，未合并、未部署。安装与限制见 [collab说明](../dsh/collab/README.md)，最终提交与CI以PR为准。后续优先验证真实DeepSeek回复，再决定是否扩展阶段2；不要重复重建骨架。

2026-10-21 Issue #229 阶段 1：`dsh/collab/` 频道服务插件（DSH Host 插件，绝对路径加载）——SQLite 频道/消息、DSH 原生成员（至多执行一次、重启恢复不重发、接力上限）、cloud_web 服务端（cc-connect 不改代码接入）、`/collab` 最简页。隔离 DSH_HOME 真机联调：真实 cc-connect+Claude Code 回复、DSH 成员经真实 Session+mock LLM 回复并转交、重启后历史保留、cc-connect 真实 ChannelHistory 读取兼容；15 项单测入 CI。未验证真实 DeepSeek 回复与 gate 下自动补历史；未部署。gpt-6-astra 代码审查进行中。

2026-10-21 Issue #229：新增 `dsh/`，在 DeepSeek Harness 里做 Discord 式频道 + 多种 AI（DSH 原生模型成员与经 cloud-web 接入的 cc-connect 外部 Agent）+ 语音/设备外接的设计。只含设计（dsh/README.md）、上游 DSH 固定提交、同步脚本和 `client-ui-discord` 包骨架；同步脚本已对固定提交验证两次幂等并拒绝嵌套仓库目标，尚未执行 DSH 安装与构建，无运行功能。未改 bridge/ 与 companion/，未部署。

2026-10-21 Issue #223：ACP 对端声明 `agentCapabilities._meta["dsh/steer"]` 时，gate 忙时插话改走 `SendMidTurn`（session/prompt 带 `_meta["dsh/steer"]`，对端并入正在跑的那一轮并立即回 `_meta["dsh/steered"]`，输出仍从原 prompt 流出；没有在跑的 prompt 时对端拒绝，cc-connect 回落排队，不会另起一轮）。gate 改为逐条询问 `SupportsMidTurnInput`（ACP 握手后才知道），Codex/Claude Code 行为不变。`promptCapabilities.image=true` 时图片发 ACP image 块（png/jpeg/webp/gif，其余仍存盘写路径）；DSH 的 `tool_call_update` 不带 title，进度卡片结果行改用 tool_call 的名字。插话不再附 model-control 说明（那一轮的 prompt 已带）。DSH 侧 steer 是对 dsh-acp 0.2.1-rc.2 的补丁，已收进 `integrations/dsh-acp-steer/`（`apply.sh` 打补丁，见该目录 README）。真实 Discord 私有测试频道（借鲸鱼娘 bot 第二连接，只收测试 webhook）验过插话、带图插话、发图、卡片；未部署，线上切换另行记录。

2026-10-21：rc5 Linux 真机实测剩余问题（分支 fix/rc5-linux-followups，基线 main 9b880ec6）。重配已有机器人时，页头和确认页按人设文件实际写的回答语言显示（GET /setup/persona 和结果里的 reply_language 读 `<!-- conest:reply-language -->` 下一行），不勾「改现有人设」时写明沿用、怎么改；setup apply / token 校验遇 Discord 429 按 retry_after 重试（最多 3 次、单次不超过 10 秒，超了如实说要等多久）；jev 提示、jev 失败原因、保存页步骤行、token 无效、gate 提示、预设人设名补日文（步骤键名保持英文给脚本用，网页按语言翻）；setup apply 首次运行到写项目时才建 config.toml，token 无效不再留下空模板；媒体库不再默认找 ~/im-bridge/bin，只认 CONEST_MEDIA_BIN_DIR，NAS 根目录只认 CONEST_MEDIA_NAS_ROOT（没设就不用 NAS、不提示 NAS 没挂）；公开副本会带出的私有默认值改成必须给：contrib/gate 的 gate_switch.py / sync_gate.sh（SWITCH_HOST、SWITCH_TS_IP、SWITCH_WIN_HOME）、companion/tools/smoke_device.py（--instance-dir / --releases-dir 或 CONEST_DEVICE_*）、role-household 快照的 dial.py（RH_TEAM_DIR，没设不读忙闲）和 tools/smoke_phone.py（RH_CO_LEAD / RH_CO_SUB）；向导新建的项目写 show_quota_indicator = false、show_workdir_indicator = false，已有项目不动；install.sh 私有仓库不再打出 curl 404、装完的文档链接指向所装 tag，GETTING_STARTED 写了 CONEST_VERSION。未部署。

2026-10-21 Issue #213：肥鱼12:10现网v3日志为补答格式失败后超时，旧修复已部署。v4改为单一结构化答复schema，在插件内验证后转Text，不进入工具执行器；原模型/历史、两次60秒、失败与推理边界保留。新增回归旧版3红、修后真实运行时契约67项通过，真实历史隔离回放已走通，最终证据及部署见PR。单一Codex实现/自查，未宣称供应商故障消失。详见[公开答复出口](../integrations/dsh-public-output/README.md)。

2026-10-21 Issue #208：G哥插话后公开回复延迟。已分别复现 Codex commentary 被缓冲，以及核心在工具边界冻结旧预览却不为新文字恢复；修复明确 phase 的普通公开文字分类、可恢复冻结状态与新段落收尾。严格语音、未知phase和内部推理边界保留；运输失败不因新文字恢复，旧消息不被覆盖。适配器回放、真实 Engine→gate→app-server→预览链路和三次真人输入的 STREAM2 CUJ 已通过；原版四条回归失败。全量/race/CI与部署状态见对应PR，真实频道待自然验收。详见[插话公开回复](CODEX_INSERT_PUBLIC_REPLY.md)。未接管他人PR清理或语音优化。

2026-10-21：Issue #203 / PR #206 Windows 支持（分支 feat/windows-support）。
- 装：Release 多出 windows/amd64、windows/arm64 两个 .zip（内含 cc-connect.exe，进 checksums.txt）；根目录 `install.ps1`，PowerShell 一行 `irm …/install.ps1 | iex`（私有仓库用 `gh api … | Out-String | iex`），校验 sha256、装到 `%USERPROFILE%\.local\bin`、加进用户 PATH。install.sh 在 Git Bash/MSYS 下指去 install.ps1。
- 适配：向导链接在 Windows 用 rundll32 打开（`cmd /c start` 会在 `&next=` 处截断）；Windows 重启改为子进程+父进程等它退出（原来父进程直接退出，计划任务失去监管）；next_steps 在 Windows 给 PowerShell 的 Start-Process 而不是 nohup；系统语言在 Windows 读 GetUserDefaultLocaleName；CLI 探测补 `%APPDATA%\npm` 和 PATHEXT；后台服务沿用上游的「任务计划程序」登录时启动。
- 顺手修（三端）：管理接口 Stop 改 5 秒 Shutdown，「重启生效」的回复不再被掐断（Windows 验收首跑暴露）；`cc-connect daemon install` 不带参数时用 `~/.cc-connect`，不再要求在该目录下运行（Windows 验收暴露）。
- 验证：release.yml 新增 smoke-windows（发布前验包）和 verify-windows（发布后在干净 windows-latest 按文档命令装、首次运行、向导页、重启、Ctrl+Break 退出、setup apply 假数据、计划任务安装/卸载）；ci.yml 加 GOOS=windows build+vet。v0.1.0-rc4 是这个分支打的预发布。Windows 真机、真凭据配成功未测（Linux 真机另有人测）。

2026-10-21：n150 Linux 真机实测问题修复（分支 fix/setup-n150-findings，基线 main 62aec4e3）。setup apply / 网页向导：回复语言为 角色 reply_language > 请求 language（--lang）> 本机 locale（不用 Discord 服务器 preferred_locale：默认 en-US，会把中文电脑配成英文），代码原样传（zh-TW、ko 不截断），结果里写 reply_language/reply_language_from，没指定时给不阻断的 reply_language_default；网页向导用顶栏右上角的语言作默认回复语言并显示「机器人回复语言：X」，向导文案中英日（用户 2026-10-21 定），其他语言界面回落英文，文案集中在 web/src/pages/Setup/texts.ts。网页和命令行首次运行都不再说备份了旧配置（store 判断配置仍是首次模板）。CLI 没登录给阻塞的 agent_not_logged_in（带登录步骤），token 401 给阻塞的 discord_token_invalid（带重置链接），dry-run 不再说“已保存”、persona_written 如实，首次运行不再说“previous config kept”，setup clis 为空或都没登录时 stderr 给提示，中文机器人名变 role-N 时 steps 说明原因（文档已改）。同一 token 多处在线查不出，只写进文档。Go 沙箱全量通过；隔离 HOME + 假 Discord 跑了 CLI 前后对比和网页向导全流程（PR 描述）。未部署。

2026-10-21 Issue #204：指定 bot 按具体请求代批所有类型工具权限。单一 Codex 实现/自查，无独立 reviewer。Discord 配置 permission_approvers，需共享频道会话；名单与可信授权说明来自操作者配置。随机请求编号隔离后端重复 ID，跨频道/过期/并发/多个 cron/适配器失败均受控，真人按钮保留；不代答偏好问答。回归含真实 Gateway 入口和核心 ReceiveMessage CUJ，目标 race/vet 通过。全量 Go 首轮只有向导中文断言受宿主 LC_ALL 覆盖 LANG 失败；清除 LC_ALL/LC_MESSAGES 后 cmd 包全部通过，未修改向导源码或测试。源码未部署，发布及真实验证看统一运行交接。详见 DELEGATED_PERMISSIONS.md。

2026-10-21：PR #198 易用性（分支 feat/onboarding-ux）。新人和 AI 的装、配、上线现在只有一条路：
- 装：打 tag 后，`.github/workflows/release.yml` 编出 macOS/Linux × arm64/amd64 四个包（带网页向导）发到 Release，用根目录 `install.sh` 装。Windows 见下面 #203。
- 配：没有配置时运行 `cc-connect`，会自动打开向导并在终端打印链接；SSH 下给出 `ssh -L` 命令。AI 用 `cc-connect setup apply`，见 AGENTS.md 文末一节。
- 确认上线：以下情况 setup apply 不再报成功，返回 `ok:false`，带阻塞 warnings 和链接——Message Content Intent 没开或查不到、机器人不在服务器、查不到所有者。查不到所有者时 allow_from 写成 `set-your-discord-user-id`，谁的话都不听；带上真实 ID 重跑后会被替换。显式写 `*` 时给一条不阻断的提示。
- 向导填的默认频道写进 `group_reply_all_channels`；`cc-connect update` 按 checksums.txt 校验。

验证：Go 单测覆盖以上各条，CI 全绿。v0.1.0-rc1 和 rc2 用 install.sh 在隔离 HOME（无 go/node）真装过；用假 Discord 走完了网页向导和 CLI，截图在 PR 评论。真机器人实测见 PR 讨论。
未部署：线上实例不受影响（已有配置不进向导，已有非空 allow_from 不改）。实习生试用和公开仓库另做。

2026-10-21：Issue #199 频道任务看板移植进 bridge/（分支 feat/199-channel-board，基线 main 56db4bfb）。来源是线上 maomao 分支已审过的两个提交（cc-connect 69f8380b、1a86b360）：项目配置 channel_board = true 时，一个进程里四个 bot 共用每个 Discord 频道一条置顶「频道任务看板」，原地编辑，列在做的（每 bot 一行、子 agent 子行）、排着队的（排队消息、定时任务、计时器）、今天做完的（最近 5 条）；消息 ID 存 data_dir/channel_board.json，重启后改同一条，丢失时按页脚标记找回。默认关闭；与 #193 team_board、#159 任务卡共存，不改它们（team_board 线上未开，两者都开会出现两条置顶）。移植只在 engine.go 合了三处冲突（Engine 字段、排队项 fromBot、EventError 分支与 input.finish 并存）。go test ./core/... ./platform/discord/... 通过；未向真实 Discord 试发。

2026-10-21：PR #194（Refs #113 / #159）在 #193 置顶任务入口上接入显式跨轮同卡、task list/show 和真人验收记录。修复四处生命周期缺陷：验收被回合结束覆盖、非法续接污染历史、验收落盘失败后重试虚假成功、验收旧卡误清新卡候选；四条回归在原 PR 上失败，修后通过。生命周期变更先校验、落盘成功再转移续接归属，验收成为不可回退的终态；累计序号与每轮64条预算分开。新 CUJ 覆盖开任务→续接同卡→真人验收及状态栏移除，编译CLI→隔离Unix socket→Engine→假平台的查询和验收通过。Go沙箱全量46包、目标race、全CUJ、vet与全包构建通过；最终CI结论见PR。无子Agent，本次修复由同一Codex自查；未部署、未发真实Discord消息。--by只记录本地调用者声明的验收人，不是身份认证。语音查询、真实频道验收和自动事实关联仍待后续，不关闭相关Issue。详见[公开进展说明](PUBLIC_PROGRESS.md)。

**Discord 回复目标路由（2026-10-21，Issue #195）**：真人回复其他 bot 时，主 bot 的 group_reply_all 原先仍将消息交给 gate；关闭回复 ping 时目标 sub 还会漏收。平台入口现先按新正文显式用户/角色提及，再按结构化回复作者决定收件人；别人的 bot 回复在命令、附件、gate/队列处理前退出。引用正文不参与收件人判断；缺失/删除引用须显式 @，不猜默认主 bot。普通消息、DM、转发、真人互相回复及 bot handoff 维持既有策略。
- 自查：同一 Codex 完成，无子 Agent 或独立 reviewer。通过真实 Gateway handler 的离线双 bot 回归：原代码 ping_on/off 均错误投递主 bot，ping_off 同时漏掉目标 bot；修复后通过，并覆盖显式改点名、角色、双点名、引用正文里的旧 @、第三方 bot/webhook、缺失引用、广播开关、/new 等。测试不连接真实 Discord/模型。
- 验证：24 组双收件人场景通过；Go 全量（no_web、-p 1、沙箱）、Discord 包全量 -race、go vet 通过。
- 发布状态单独核对统一交接；源码测试与模拟入口通过不代表真人频道已验收。

2026-10-21：#113 置顶团队状态栏任务入口已实现，独立 PR #193，分支 feat/113-pinned-task-index（main 92855315 起）。从发布分支引入状态栏 ae2d2fa8/a99b375b 及已验证的清理测试修正，不带 #174 的语音改动。公开任务投影经共享 team 心跳汇总本频道卡片链接；waiting 优先，result_ready/失败/取消移出入口，历史保留。正常结束的 waiting 可重启恢复，未结束轮次仍按原协议中断；跨轮等待事项的关联/解决仍属于 #113 后续范围。网络编辑失败不重发，置顶失败保存消息ID并重试原卡。无子Agent、未部署、未向真实Discord发消息。46包Go沙箱全量、目标race、CUJ、vet、构建通过；编译CLI→Unix socket→真实Engine/团队心跳/状态栏→假平台通过。状态栏网络/置顶恢复及关闭/失去主bot身份后发布循环退出的回归在旧版失败、新版通过。详见[公开进展说明](PUBLIC_PROGRESS.md)；源码合并与生产部署分开记录。

2026-10-21：Issue #189 原模型请求的安全错误分类恢复。00:00生产诊断 original/provider_error，v2抹掉机器错误码导致DSH有限重试/上下文恢复失效，原始具体分类无法还原。v3保留白名单分类及数值退避信息，错误正文仍不可公开；不重复工具或放宽补答边界。19项新回归旧红17、新版全量58通过；Go沙箱全量通过；真实隔离ACP两进程同会话、注入限流和实遇TRANSPORT均恢复，工具0。无子Agent、未代发Discord、当前尚未部署。详见[插件说明](../integrations/dsh-public-output/README.md)。

2026-10-21：Issue #187 同步角色小家 c507674 快照到 role-household/（分支 feat/187-rh-sync-c507674，基线 main 1034014f）。内容等于角色小家本地仓库 c507674 的 git archive（替换 #141 的 4b30043 版，51 个提交），仍去掉 docs/evidence、docs/screenshots；roles.toml 不进 git，只带 roles.example.toml；tests/test_cloudweb.py、tests/test_push.py 里的真实 Discord ID 换成虚构 ID。新增：hub 的 cloud_web 网关（cc-connect bot 经 /cloud-web/ws 进频道，配套 #170/#175/#177）、多频道与归档、历史翻页/搜索/未读、手机布局、Web Push 与添加到主屏幕、子进程表、事件通道（出错红圈）、大厅不再刷「做完了」、成员栏一个角色一行、频道网页按 Discord 对齐的显示修复、进度卡片行内 Markdown、手机视角巡检 tools/smoke_phone.py（含 --co-mention）、自动选频道 jev 后端；云端 hub 改经 nginx https，nginx 配置里公网 IP 用占位符。firmware-xiaozhi/ 不动。只改 role-household/ 与本条；本仓库 CI 不跑 role-household/。未部署。

2026-10-20：Issue #177 cloud_web 团队协作三项对齐 Discord（分支 feat/177-cloudweb-team，合并三条已审分支）：频道补发（实现 ChannelHistoryReader / AgentReplyMarker，读 hub `GET /api/rooms/{room}/messages`，agent 回复帧带 `agent=true`）；副角色干完队长派的活最终回复自动加 `<@队长>`，队友状态显示 #频道名；子 agent 表（SubTaskTablePayloadSupport、2 秒 ProgressUpdateThrottler，只发给声明 `subtask_table` 的网关）。冲突两边都留：Reply 帧内容走 returnToLead、再按 Agent 加 agent 标记（新增合并回归测试），replyContext 同时带 MsgID/lead/final 与 Agent，测试里重复的发送记录 transport 合成一个。cloud-web 包单测通过，CI 结果见 PR。配套网关改动在角色小家 hub。本条为源码记录，未部署。

## 2026-10-21：Codex插话后空响应，发布候选未部署

确认生产发布基线遗漏主分支#161的子会话通知隔离；插话已送达，子Agent通知提前结束父轮次。已按真实适配器+假JSON-RPC复现空结果，最小回移后通过。证据和发布限制见 [CODEX_CHILD_NOTIFICATION_ISOLATION.md](CODEX_CHILD_NOTIFICATION_ISOLATION.md)。旧桥接可能误报空闲，重启前必须核对实际父会话结束；当前未动生产。

## 2026-10-21：#193/#194 任务卡本地发布候选

用户已授权修复、合并并本地部署。#193 已合并，#194 经四项 CI 通过后合并为 38adde530395f45fae2b14212bd2eb7da367f015，审核 head 为 f2731f008bf403e4eabfad921f7f9865d086a461。此发布分支以实际生产源 2e019c3caf30148eb2334bee7ac4878e19bc6e84 为基底，仅加入上述任务卡生命周期及置顶状态栏索引；保留独立语音、Claude 严格续接、#197 回复路由等现有实现。

续接先校验和落盘再转移归属；验收终态不被回合结束覆盖；保存失败回滚内存；验收旧卡不清除新候选。新增本地 task list/show/accept，--by 仅记录归属，不做身份认证。进行中和待处理卡片链接汇总到现有置顶状态栏，结果/验收完成后移除入口，历史保留。每会话最近候选 24 小时有效，每轮最多64条。

发布核验与备份由 .local/deploy_card194.py 执行（私有文件不入库），只替换二进制，保留配置、模型、会话、调度和ACP插件；任务日志及状态栏绑定在停机后备份。实际运行版本及部署结果以 /path/to/yijiazi/docs/HANDOFF.md 的现场记录为准。不能把候选构建或自动测试当作真人频道验收。

2026-10-21：语音延迟复核发现PR #174未上线；原发布因缺失可选绑定文件中止，旧计划作废。用户改为全部角色用豆包API，新增volc专用后端，禁止本地音色回退；已有豆包音色三次真实短句首包0.451–0.660秒、总0.919–0.988秒，不播放。详见 VOICE_LATENCY_20261021.md；代码验证和实际部署分开记账。

2026-10-20：#172 / PR #173整合：肥鱼用15:59历史无工具补答精确复现非法JSON（未转义控制字符），修前5次3失败，补编码示例与格式纠正重试后3次通过，工具0；DSH39项真实安装契约通过。大豆包子Agent已核实四轮有实际非零命令，添加安全步骤/退出码诊断，保留失败而非隐藏；身份与重复授权修复同时保留。桥接整合全量通过，最终race/CUJ与发布候选验证另记录。肥鱼子Agent因429未能启动，实际修复由父Agent完成。当前源码待最终审核合并，生产尚未切换，原任务未重跑、无Discord测试消息。

2026-10-20：Issue #172，分支 fix/172-identity-permission。针对大豆包自称 C酱，实际投递时按 team 配置注入自身名称，并为队友缓冲保留作者；首次/续接/排队/语音/插入均覆盖，模型实际遵守仍待真人验收。重复授权在平台回执阻塞窗口可精确复现 unknown permission request；核心先原子认领请求，避免再次消费同一个 pending。肥鱼诊断改为安全枚举直写 ACP stderr；15:59 的具体生成失败类别仍不可追溯，不能宣称已修好。目标回归先红后绿、20次race、CUJ/核心全量、目标vet、DSH37项真实安装离线契约通过；首次桥接全量仅核心的旧无作者断言失败，更新作者和原文断言后核心补测通过。大豆包后续 stream ERROR 已按真人新授权交一名子Agent在独立worktree定位，整合/最终全量/部署另记。详情见 [现场与边界](BRIDGE_IDENTITY_AND_PERMISSION_172.md)。当前未改生产配置/会话、未重跑原任务、未发Discord消息。

2026-10-20：Issue #175 cloud_web 进度展示对齐 Discord（分支 feat/175-cloudweb-botux）：实现进度卡片，选项名同 discord（`progress_style` / `progress_card_entries` / `progress_line_len` / `progress_hide_thinking`），默认 card、最近 6 步、每行 200 字、做完保留；网关没声明 preview + update_message 时退回每步一条。文字流式预览不走 cloud_web preview（避免工具调用时冻成截断的中途预览），改为每段发正式回复；`preview_start` 先登记 ref_id 再发，`preview_ack` handle 为空算失败。cloud-web 包单测覆盖，CI 结果见 PR。配套网关改动在角色小家 hub（feat/plat-botux）。本条为源码记录；线上换版另记。

2026-10-20：Issue #169 `message.received` / `message.sent` 钩子的 extra 多带 `agent`（运行时类型）和 `agent_session_id`（会话已有时），命令钩子多 `CC_HOOK_AGENT` / `CC_HOOK_AGENT_SESSION_ID`（分支 feat/169-hook-agent），外部 sessionlog 可按运行时统一记录对话。单测与设了 `SESSIONLOG_PY` 的端到端测试本机通过；CI 里端到端测试按设计 SKIP。用法与测试命令在 bridge/MAOMAO.md。本条为源码记录，未部署。

2026-10-20：Issue #168 cloud_web 把网关给的 `mentioned` / `from_bot` 带进 `core.Message`（分支 feat/168-cloudweb-mention），gate 能判断谁被 @、队友 bot 没 @ 自己时只当上下文；`from_bot` 的消息不受 `allow_from` 限制（网关为自己的 bot 作保，同 Discord allow_bots）。5 种组合单测通过，字段说明在 bridge/docs/cloud-web.md。本条为源码记录，未部署。

2026-10-20：Issue #160 把线上 cc-connect maomao 在快照基点 8b27736e 之后的 49 个提交（到 6dbb2d73）搬进 bridge/，只传快照不带历史；冲突按用户「他那边新功能就是我们新功能」「我们这边功能要定期给他同步过去」两边都留，逐条裁决写在 PR 描述。要点：antigravity 原生额度（stream_json）与云端额度（经典模式）并存；轮次主流程合入满载重试/prompt 过长重跑/补图/cron 排队，语音输入严格续接轮次不进这三条；尾注额度会话缓存优先、单窗口"额度剩余 N%"、双窗口"5h 剩 N% · 周 M%"；bot 接力熔断按用户 2026-10-18 原话整体去掉（删 handoff_quiet_test.go）。测试里的真实 Discord ID 已换假 ID。bridge 沙箱串行 Go 全量通过。maomao 分支此后冻结，线上改动直接进 conest。本条为源码记录，未部署；线上换版另记。
2026-10-20：生产发布整合 release/159-public-progress。以正在运行的 a99b375b 为基线，依次采用 #156（5228177f）与 #162（853f4330），保留此前状态栏跟随主 bot、app_server 严格续接及停机权限等待修复。README/config.example 冲突只采用公开进展说明，不引入其他分支的 setup 文档。补入 fab55cd3 的 bridge 测试沙箱（仅测试文件与 tests/testutil），避免测试调用真实 CLI。全量回归发现既有 TestFormerLeadRemovesOldBoards 固定 sleep 与异步 os.WriteFile 相撞：40 次重复可复现空读；改为同步执行有界清理后断言，100 次 race 重复通过，未改生产清理逻辑。发布验证日志在本工作区 .local/ 与 /tmp/conest-progress-release-*.log；实际生产切换、备份及真人验收结论以 /path/to/yijiazi/docs/HANDOFF.md 为准。用户本轮明确授权部署 #156/#162，公开进展仅启用 cursor/gjiang/deep；不变更模型或语音服务。

2026-10-20：Issue #159 公开进展，独立分支 feat/159-public-progress。复用 #116 的任务模型/卡片布局，接入真人初始、排队、语音续轮的显式 progress CLI 与本地 API；不从 Thinking/工具文本提取进展。run+项目+会话+递增序号防串轮，落盘后异步更新卡片和关键讨论串；网络响应丢失先按自身消息标记核对，重启将未结束运行记为中断。结果显示“已有结果 · 待验收”；语音取公开短回执，长摘要只播查看卡片提示。已验证本地 socket→卡片、安静模式队列CUJ、语音、重启/重复/停止/落盘失败/丢回执与三后端提示入口；本机沙箱Go全量、CUJ、五包目标race、vet、全包构建及编译CLI真实socket验收均通过，CI结果见PR。默认关闭，未部署、未发真实频道消息；跨轮同卡、任务查询、主人验收仍属于 #113，不关闭该Issue。#155已合并的插件也没有在本轮部署。用法与边界见[公开进展说明](PUBLIC_PROGRESS.md)。

2026-10-20：Issue #155 肥鱼公开答复失败。用户授权一名子 Agent 实现，父 Agent 审查并合并；独立分支 fix/155-deepseek-public-reply。修复 DSH 流收集器误用 block-end 顺序及漏收 delta-only 文本，合法 reply 现在按运行时的首次出现顺序组装；取消后不再派发迟到工具，补答共用60秒期限由收集器自行执行。失败诊断只记阶段、尝试次数和固定原因枚举。父 Agent 复核修前4项回归均失败、修后含真实 DSH 离线契约共37项通过，bridge 沙箱串行 Go 全量通过。隔离真实 ACP 读取一次合成文件后精确回答通过；13:14 失败前108条消息经只读投影重建补答，真实同模型返回严格 reply、零工具调用，也通过。12:54及13:14生产记录只保留改写后终态，无法确认这两次的具体触发条件，不把合成复现冒充现场根因；Issue 保持开放跟踪现场验证。详见[验证记录](DSH_PUBLIC_REPLY_155.md)及[插件边界](../integrations/dsh-public-output/README.md)。尚未部署，未重跑原任务、修改原会话或发送 Discord 消息。

2026-10-20：Issue #148 安装向导（分支 feat/setup-wizard，基于 docs/onboarding）。cc-connect 网页新增 /setup：选平台 → 机器人（复用已有或填 token；校验、列服务器/频道、邀请链接；飞书扫码后选默认群）→ 每个角色选本机 CLI（只列装了的，带版本和登录状态；可挂第三方 API）→ 人设（默认人设中英两版、回答语言）→ 兜底角色 → jev（填完自动测概率，不拦保存）。同一逻辑给 AI：`cc-connect setup apply --json`、`POST /api/v1/setup/apply`。第三方 API 对不上 CLI 协议时由 `core/protoconv.go` 本机转换成 /chat/completions（provider `api_format = "openai_chat"`）。首次运行没有项目时只起向导。gate 读向导写的 `jev.json`（给概率才用）和 `gate-team.json`（lead = 兜底角色），没有模型时只按规则判、判不了交给兜底角色。只在隔离实例（临时配置、临时端口、假 Discord/模型）验证；未部署，未同步回 maomao 分支。
2026-10-20：修复共享桥接优雅停机等待权限答复时永久阻塞。09:00:33 的未答复权限请求在 10:54 停机前仍未 resolve；关闭 agent 的事件通道无法唤醒只等待 pending.Resolved 的事件协程，Engine.Stop 的 messageWorkers.Wait 因而无法完成。权限等待现在同时监听 engine context 和会话 stop，取消时直接返回，不批准权限、不继续工具执行。新增 TestEngine_StopUnblocksPendingPermission，原代码稳定失败、修复后通过；Go 全量 no_web、核心 CUJ 与权限/停机 race 通过。此条为源码记录，生产部署另见统一交接。

2026-10-20：Issue #145 将肥鱼公开输出边界前移到 DSH llm/stream：中间 text 归入 reasoning；终态基于已有证据进行最多两次、无工具的结构化补答，只发布验证后的 reply。桥接所有无正文 end_turn 均报回复失败，并支持 DSH 宣告的 session/resume，避免重启另开会话。合成回归旧路径失败、新路径通过；真实隔离ACP、冷恢复、只读工具后补答通过；80步骤/117工具调用回放无原始正文。20项Node回归、Go全量、ACP竞态、vet和构建通过。首次全量出现会话删除卡片时序失败，单项与CUJ三次复跑及再次全量通过。详见[部署插件](../integrations/dsh-public-output/README.md)。本条为源码记录，生产发布另记统一交接；须保留Claude strict补丁20c79756。

2026-10-20：Issue #136 按 #134 的代码审查修 cn_dial：名牌名字限宽加省略号（`NameLabelMaxW`：名牌最宽到参照「等待主机 · 工作中」所在高度的避让圆弦长，长名字不再把名牌压到脸上或越出圆屏），单测加 6/10 字名字；`DialMetrics::Supported()` 改为 `cn_dial::Supported(m, PillFont)`，按板上字体（字宽、行高）判定，单测扫 14/16/20/24/30px（最小短边 199/199/237/275/332）；光晕放回名牌下面；充电呼吸只在充电/低电变化时重开；新增 `DialOverlay::ClearBusy()`（工作状态未知或断线时隐藏）。只改 firmware/dial/ 与本条；未刷板、未部署。

2026-10-20：Issue #133 / PR #134 表盘第二步：新 ESP-IDF 组件 `firmware/dial/components/cn_dial_lvgl`（`cn_dial::DialOverlay`，只依赖 LVGL 与 cn_dial），一个类画名牌（含 DECOR.md 3 工作状态）、状态胶囊、电量弧、字幕气泡；外观与数值取 #110 的补丁 0006/0010 与 DECOR.md，角色小家的音柱/跳点/停止方块/「被打断」作为胶囊内容。尺寸全走 `DialMetrics`，纯计算在 cn_dial `overlay_layout.{h,cc}`；JSON 删掉与 conest 重复的 `rh_dial` 名牌/胶囊数值（0006 设计值，240 屏现值作 `min_px` 下限），`min_short_side` 161→199（检查含「· 工作中」）；`battery` 不是 `gauge` 的屏不建电量弧。角色小家固件（xiaozhi-esp32 分支 rh-dial-step2）的 `RhDialDisplay` 只做接线。未做：全屏头像动画 CNAS（第三步：0005 写死 466、1.28 带宽待实测、240 素材在草稿 #123）。#110 合并后按它的版本对齐 DialOverlay。只改 firmware/dial/ 与本条；未刷板、未部署。

2026-10-20：Issue #127 按代码审查修 cn_dial：`font_px()` 不再低于 `font_min_px`（板上无合格档时取 font_min_px，`pick_font().on_board=false` 供固件打日志）；`ScreenProfile::Valid()`；dial-layout.v1.json 新增 `min_short_side`=161（16px 字时 160 及以下名牌越出安全圆），`DialMetrics::Supported()` 为假时不画表盘；单测补 fonts_px={12}/font_min_px=16、Valid、W=16..1024 胶囊在安全圆内且不重叠、环像素深度 d16 在 W≥1204 超出 uint8（固件改 uint16）。只改 firmware/dial/ 与本条。

2026-10-20：Issue #124 表盘屏幕参数与尺寸换算抽成共用组件 `firmware/dial/components/cn_dial`（`ScreenProfile` + `DialMetrics`，纯 C++，不依赖 LVGL/ESP-IDF）。数值只在 `firmware/dial/layout/dial-layout.v1.json`（466 画布单位；conest 数值取自 #110 的 DECOR.md 与补丁 0006/0010，角色小家 240 屏现值作下限），`tools/gen_layout.py` 生成头文件，CI 新 job `dial-metrics` 检查一致并跑主机单测（466/240/360 圆屏、320×240 与 240×320 假屏）。角色小家固件用 `EXTRA_COMPONENT_DIRS` 引用本目录，表盘尺寸只经 `DialMetrics` 取，hello 多报 `display`（主机只记日志）。只改 firmware/dial/、CI 与本条；未刷板、未部署。下一步：角色小家把已移植的 conest 电量弧/气泡/工作状态放进本目录，不等 #110 合并。
2026-10-20：#119 的独立语音转发在 feat/119-private-voice-relay 实现，基于 #135 d72bb66a。可信角色配置 relay_project 默认空；私有 relay 不复读到频道、不自动降级，原生身份验证、请求幂等和失败回执持久化。协议、限制与验收见 [VOICE_PRIVATE_RELAY.md](VOICE_PRIVATE_RELAY.md)。未部署、未重启服务、未刷板；#135 原交付包未修改。ASR合成样本首次4807ms、同句热态579–599ms，见[计时](ASR_BENCHMARK_20261020.md)，不能当作历史5.2秒的直接归因。

2026-10-20：Issue #122 / fix/acp-strict-session-resume 补齐 ACP session/resume。DeepSeek 后端声明 resume={} 而非 loadSession，独立空会话跨进程恢复已通过（无模型调用）。严格失败不新建，load 后端保持优先，详见 [恢复契约](ACP_SESSION_RESUME.md)。未部署、未重启桥接/8796；真实语音仍待验收。

2026-10-20：Issue #120 修复 ACP 全轮私密输出被过滤后仍返回成功、显示 `(空响应)` 的缺口。整轮统计跨消息/工具保留，RPC边界取快照；只有显式过滤证据且无公开正文时发专用错误，保留会话、不自动重跑工具、不写成功历史。分支 fix/120-acp-no-public-answer；合成mock RPC旧版8例失败，验证见[公开回复边界](ACP_PRIVATE_OUTPUT.md)。本条为源码记录，部署另在统一交接记账，发布须保留Claude strict补丁20c79756。

2026-10-19：Issue #111 补齐 #105 遗漏的裸summary私密区块，保留公开details/summary与代码示例。普通text的analysis后接summary已用真实通知形状的合成回归复现旧版失败；现场仍无compaction事件。分支fix/111-acp-summary-output；此条是源码记录，生产部署另在统一交接记账。发布须保留Claude strict补丁20c79756；用户已授权此次中断任务部署，无需再次等全闲。

2026-10-19：Issue #104 修复 ACP 普通 text 内显式私密区块泄漏、未知通知被猜为正文。现场没有压缩事件；流式边界与限制见 [ACP_PRIVATE_OUTPUT.md](ACP_PRIVATE_OUTPUT.md)。合成回归红→绿，独立分支 fix/104-acp-private-output；本条仅记录源码，尚未部署。发布必须保留线上 Claude strict 额外提交20c79756，等待所有忙碌伙伴结束。

2026-10-19：#94 修复 Codex exec 提前交付终态、历史 stderr 串轮与重复写入者。独立工作区 conest-codex-writer；原 thread 保留，部署须检查实际写锁。实现与回归边界见 [CODEX_EXEC_LIFECYCLE.md](CODEX_EXEC_LIFECYCLE.md)。本条为源码记录，尚未部署。

## 2026-10-20：同步角色小家 4b30043 版与固件补丁 14 个（Issue #140，未部署）

- 本线由用户侧 Claude 在 feat/140-rh-sync-4b30043（基线 main 472d06e）只改 role-household/ 与本条记录；不改 bridge/、companion/、firmware/。
- role-household/ 内容等于角色小家本地仓库 4b30043 的 git archive（替换 #89 的 38e754f 版），仍去掉 docs/evidence、docs/screenshots。新增：网页圆屏 SSE（/rh/dial/events，给 device-ui 外部状态，#90/#91）、板子麦克风上行、板子的话按意思进 Discord 频道（可新建频道、只念摘要）、闭麦时口令可停朗读、hello 里的 display 记日志、表盘第二步主机侧（工作状态 busy、头像按画布边长）。
- firmware-xiaozhi/patches 从 7 个更新到 14 个（format-patch v2.5.2..rh-dial-step2fix，d076dc4），表盘改用 firmware/dial 的 cn_dial / cn_dial_lvgl（锁 472d06e）；在 v2.5.2 上 git am 后与原分支 git diff 为空。已编译，未刷板。
- 检查：无公网 IP、token、.env、logs/、模型或 wav；token 只写环境变量名和文件位置。未部署。

## 2026-10-19：同步角色小家 38e754f 版与小智板子固件补丁（Issue #88，未部署）

- 本线由用户侧 Claude 在临时克隆的 feat/88-role-household-sync（基线 main bf3ced27）只改 role-household/ 与本条记录；不改 bridge/、companion/、firmware/esp32s3/。
- role-household/ 内容等于角色小家本地仓库 38e754f 的 git archive（替换 #67 的 85795de 版），仍去掉 docs/evidence、docs/screenshots。新增：唤醒词「小橘」与本地唤醒模型（sherpa-onnx KWS）、n/l 与前后鼻音放宽、语音口令（暂停/闭麦/开麦）、macOS 系统回声消除、小智板子协议服务（OTA + WebSocket）、圆屏表盘、音量、板子 Wi-Fi 升级、Discord bot 回应转到板子念（真板开关默认关）。
- 新增 role-household/firmware-xiaozhi/：上游 78/xiaozhi-esp32 v2.5.2 之上的 7 个补丁（format-patch v2.5.2..rh，b951562），在 v2.5.2 上 git am 后与 rh 分支 git diff 为空；附 FLASH.md、RESEARCH.md、scripts/。不含整片备份与固件二进制；补丁 0004 的 OTA 默认地址是作者家里的局域网地址。
- 检查：无公网 IP、token、.env、logs/、模型或 wav。本仓库 CI 不跑 role-household/。未部署。

## 2026-10-19：#53 Claude、Gemini（大豆包）与 Grok V2 新形象全面接入网页圆屏 UI（分支 feat/53-v2-claude-gemini-ui）

- **背景与目标**：大豆包（Gemini）根据主人与 C酱 指示，将 Claude（C酱）、Gemini（大豆包）与 Grok 全部三个角色的 V2 新形象与全套素材（各 10 段，4 基础状态 + 6 待机小动作）全面接入网页圆屏 `prototypes/device-ui`，素材源自 `assets/v2-claude-gemini` 分支（提交 `9a239415` 与 `2f87fcf2`），基于最新 `origin/main`（`45e4e961`）开独立分支提 PR #87。
- **详细改动**：
  1. **素材入库与清理**：
     - Claude：全部 10 段 720×720 mp4（含 `2f87fcf2` 重做的左侧额头金色问号 `thinking.mp4`，问号距中心 229–233px 完全在圆内）；单文件安全规则移除废弃的旧素材；
     - Gemini：全部 10 段 720×720 mp4（`idle`, `listening`, `thinking`, `speaking`, `curious-lean`, `doze-wake`, `happy`, `pout`, `shy-blush`, `yawn`）；
     - Grok：全部 10 段 720×720 mp4（金发双马尾哥特小王冠少女，`idle`, `listening`, `thinking`, `speaking`, `curious`, `doze`, `happy`, `pout`, `shy`, `yawn`）；
     - 清单同步：`prototypes/device-ui/assets/characters/manifest.json` 完整录入 30 段视频的准确 sha256、文件大小与规格。
  2. **逐角色裁切与几何校准 (`source.html`)**：
     - Claude：`scale: 1.02`, `tx: -2.5%`, `ty: +2.5%`, `bg: '#191f21'`；猫耳与右侧菊花发饰（及其流苏丝带）完整保留在 466×466 安全圆屏内，脸部水平居中；thinking 问号位于左上安全区；注册全套 6 段待机小动作；
     - Gemini：`scale: 1.02`, `tx: 0%`, `ty: +2.5%`, `bg: '#191f21'`；双马尾、花形发饰及星形耳坠完整保留在圆内；注册全套 6 段待机小动作；
     - Grok：`scale: 1.02`, `tx: 0%`, `ty: +2.5%`, `bg: '#1b2122'`；红宝石小王冠（距圆顶 7px 安全裕量）、尖耳、红宝石耳坠与小蝙蝠翅膀完全在圆屏安全区内，脸部水平垂直居中；注册全套 6 段待机小动作；
     - 运行 `build.py` 重新生成 `index.html`、`screen.js` 与 `screen.css`，`build.py --check` 一致性通过。
  3. **板端打包支持 (`pack_assets.py` & 测试)**：
     - `firmware/esp32s3/tools/pack_assets.py`：增强正则支持连字符与带引号动作名；`BOARD_PLANS` 支持 4.0s 闭合循环；
     - `firmware/esp32s3/tests/test_pack_assets.py`：同步更新 Grok 与 Claude 6 段小动作断言；测试全部通过。
  4. **圆屏截图与自动化测试 (`test_device_ui_events.py`)**：
     - 更新 `test_device_ui_events.py` 覆盖全套动作、角色切换与真实发声事件驱动；
     - 在 `test-artifacts/` 输出三位角色待机圆屏高清截图：`10_gemini_idle_round_screen.png`、`12_claude_idle_round_screen.png` 与 `13_grok_idle_round_screen.png`；
     - `test_device_ui_events.py` 全量 31 项测试全部 PASS。
- **边界与安全**：全程未启动子 Agent，未动 8796 服务；旧文件删除按单文件逐一确认执行。

- G哥在原 PR head 2e69ca3e 上接手：当前轮命令 DONE 但 exitCode 非零时保留失败；额度/轨迹查询等待互斥锁也响应调用者的 context，核验重试共用原来的10秒预算。
- 两条审核复现原样收进 review71_regression_test.go，修复前均失败、修复后通过；锁竞争复现从12.107秒超限变成10秒预算内返回（测试清理等待独立额度请求，整项用例仍约12秒）。另补取消与锁释放回归。
- 验证：go build -tags no_web ./...、go test -tags no_web -p 1 -count=1 ./...、go test -race -tags no_web ./agent/antigravity -count=1 均通过；最终远端 CI 另看 PR 页面。
- 仅推送 #71 分支供复审，合并与桥接重启由 C酱另行安排；未操作8796或运行中的桥接。

2026-10-19：Issue #85 原生 Codex /compact 在 feat/codex-native-compact 独立工作区实现。说明与验收边界见 [CODEX_COMPACT.md](CODEX_COMPACT.md)。当前未部署，未改原会话或生产进程。

## 2026-10-19：#53 Gemini 与 Grok 角色资产打包与上板预算验证（分支 feat/53-gemini-grok-board-assets）

- **背景与目标**：大豆包（Gemini）验证另外两个角色（Gemini 与 Grok）能否上板。扩展 `firmware/esp32s3/tools/pack_assets.py`，支持按角色定制截取规则（Gemini 与 Grok 的 `idle` 是完整的 4 秒闭合循环，取 4.0s，不需要像 G哥 那样截 2.5s；`listening`, `thinking`, `speaking` 保持 4.0s 完整循环）。执行实测打包，验证能否装入 7 MiB 预算并如实汇报。
- **改动范围**：
  1. **按角色定制截取规则 (`firmware/esp32s3/tools/pack_assets.py`)**：
     - 定义 `BOARD_PLANS` 映射表与 `get_board_plan(character)` 查询函数，保持默认 `BOARD_PLAN` 兼容；
     - 对 `gemini` 和 `grok`：`idle` 设为 4.0s @ 12fps（起始尝试 12fps，阶梯自动降至 10fps），`listening`、`thinking`、`speaking` 均设为 4.0s @ 10fps（保持 4.0s 闭合循环，丢弃尾部 0.04s 冗余帧）；
     - `select_segments` 增加 `character: str = "gpt"` 参数；处理 `thinking_calm` 时自动回退至源片段 `clip.end - clip.start`。
  2. **自动化测试套件 (`firmware/esp32s3/tests/test_pack_assets.py`)**：
     - 增加 `test_gemini_and_grok_board_plans`、`test_gemini_select_segments`、`test_grok_select_segments`；
     - 增加 `test_gemini_and_grok_end_to_end_pack`（足额预算下验证 4 段 160 帧解包与 SOI/EOI）与 `test_gemini_and_grok_enforce_7mib_budget`（断言 7 MiB 预算下超限退出码 2）；全量 34 项测试全部 PASS。
  3. **文档同步 (`docs/BOARD_ASSETS_PLAN.md`, `firmware/esp32s3/README.md`)**：
     - 同步更新 G哥 最新实测数据（6.54 MiB / 150 帧，Q75，占预算 93.5%）；
     - 详细记录 Gemini 与 Grok 的逐段时长、fps、帧数、字节数、档位与预算分析，并提供针对性的 Flash 分区规划建议。
- **实测数据与预算判定（11 MiB 新基线 vs 7 MiB 备用）**：
  - **11 MiB 预算新基线（16MB Flash，顶档 Q80 / 12fps）**：
    - **G哥 (`gpt`)**：四段保持完整原长（`idle` 取 4.65–9.90s 完整片段），合计 **10,679,852 B (10.19 MiB / 209 帧)**，占 11 MiB 预算 **92.6%**，余量 **854 KiB**；
    - **Gemini (`gemini`)**：四段保持 4.0s 完整闭环，合计 **10,237,783 B (9.76 MiB / 192 帧)**，占 11 MiB 预算 **88.8%**，余量 **1,266 KiB (~1.24 MiB)**；
    - **Grok (`grok`)**：四段保持 4.0s 完整闭环，合计 **11,077,333 B (10.56 MiB / 192 帧)**，占 11 MiB 预算 **96.0%**，余量 **446 KiB**；
    - **判定**：三角色全部在 Q80 / 12fps 顶档顺利装入，无需任何画质或帧率妥协。解包校验全部 PASS。
  - **7 MiB 预算备用方案（若到手硬件实测为 8MB Flash）**：
    - G哥截 2.50s 眨眼段：6,746,583 B (6.43 MiB，Q75/10fps，余量 579.5 KiB)；
    - Gemini（7.20 MiB，超 2.9%）与 Grok（7.85 MiB，超 12.1%）照实报超，返回退出码 2。
- **C酱 2026-10-19 落板决议**：
  - 硬件 Flash 确认为 16MB，固件分区规划为 app 3 MiB + NVS + assets 12 MiB，打包预算 11 MiB（留 1 MiB 余量）；
  - G哥 `idle` 取网页同款完整片段（4.65–9.90s），不再截短；三个角色均以 Q80 / 12fps 顶档高画质落板；
  - 硬件到手后先跑 `esptool flash_id` 确认容量，万一是 8MB 则使用 `--budget-mib 7` 备用方案。
- **边界与安全**：未启动子 Agent，未动 8796 进程或配置。基于最新 `origin/main` 新建独立分支，提独立 PR。

## 2026-10-19：#53 Gemini 与 Grok 角色全套素材及待机小动作接入（分支 feat/53-gemini-grok-characters）


- **背景与目标**：为圆屏原型（`prototypes/device-ui`）接入 Gemini（大豆包）与 Grok 两位新角色的全套 7 段高清素材，支持开发栏角色切换、顶部名字（「大豆包」/「Grok」）动态同步、`doze / happy / shy` 待机随机插播小动作及下拉动态联动，逐角色精细校准，确保测试 100% 通过。
- **改动范围**：
  1. **素材入库与清单同步**：
     - 从 `journal/artifacts/idle-variants/{gemini,grok}/` 筛选出两套共 14 段 720×720 mp4（每角色 7 段：`idle`, `listening`, `thinking`, `speaking`, `doze`, `happy`, `shy`，严格排除临时文件）；
     - 入库至 `prototypes/device-ui/assets/characters/{gemini,grok}/`；
     - `assets/characters/manifest.json` 录入 14 段视频的精准 sha256、文件大小与规格（清单总条目扩展至 38 条）。
  2. **原型页面与调度逻辑 (`source.html`)**：
     - 控制台配置：`#cn-preview-character` 增加大豆包（Gemini）与 Grok 选项；精简语音端点列表，删除 8796 未配置的 `/device/desk-gemini` 与 `/device/desk-grok`，避免连接失败；
     - 角色配置注册：`VALID_CHARS` 追加 `'gemini'`, `'grok'`；在 `CHARACTER_CONFIG` 中注册双角色配置（背景 `#1b2122`，`scale: 1.10, tx: 0, ty: 1.5%`，Gemini 的 `displayName` 设为「大豆包」，Grok 的 `displayName` 设为「Grok」）；
     - 顶部名字与 aria-label 动态同步：修复原型角色切换时顶部极简徽章仍显示旧绑定的缺陷，角色切换时自动将 `.cn-role-name` 与 `aria-label` 更新为当前伙伴名（「大豆包」/「Grok」/「G哥」）；
     - 动态小动作下拉联动：实现 `syncIdleVariantOptions()`，在角色切换时自动重构 `#cn-idle-variant` 选项，确保下拉列表与当前角色动作池精准同步；
     - 角色识别与切换接口：在 `connectVoiceService` 中支持 `gemini` 和 `grok` 识别；在 `window.__conestDeviceUI` 暴露 `setCharacter(char)` 支持测试与程序化切换。
  3. **构建同步**：
     - 运行 `build.py` 同步生成 `index.html`、`screen.js` 与 `screen.css`，`build.py --check` 一致性通过。
  4. **自动化测试与高保真证据**：
     - `test_device_ui_events.py` 扩展至全量 31 项测试全部通过（测试项 17 验证 Gemini、测试项 18 验证 Grok、测试项 19 专项验证角色切换时顶部名字动态同步更新为「大豆包」/「Grok」/「G哥」、测试项 31 验证真实服务端路由下切至 Grok 名字同步并触发 doze）；
     - 生成真实无头 Chrome 截图证据：`test-artifacts/10_gemini_idle_variant_happy.png`（徽章显示「大豆包」）与 `11_grok_idle_variant_shy.png`（徽章显示「Grok」）。
- **边界与安全**：未启动子 Agent，未修改或重启运行中的 8796 服务。基于最新 `origin/main`（`7e8473ae`）开新分支，单独提 PR。

## 2026-10-19：#42 圆屏素材打包工具与 CNAS 板端格式（分支 feat/42-asset-pack，未合并）

- **背景与目标**：C酱指派肥鱼做素材打包工具，把 G哥（`gpt`）的待机 / 倾听 / 思考 / 说话
  四个状态片段打成板端可直接读的 `assets.bin`，供 G哥写读端。小动作这一版不进固件。
- **交付**：
  1. `firmware/esp32s3/tools/pack_assets.py`：读 `prototypes/device-ui/source.html` 的
     `CHARACTER_CONFIG` 取 `scale`/`tx`/`ty`/`start`/`end`/`bg`，**不复制第二份数字**；
     ffmpeg 只从 `--ffmpeg` / `FFMPEG_PATH` / `PATH` 找，没有写死第三方应用自带路径。
  2. `firmware/esp32s3/ASSETS_FORMAT.md`：CNAS v1 完整格式（头部 / 片段表 / 帧索引表 /
     JPEG 数据、C 结构体、读端必须做的边界检查、预算阶梯、与网页圆屏的换算推导）。
  3. `firmware/esp32s3/README.md`：工具用法与参数表（注意 main 上原本没有这个目录，
     IDF 骨架在 PR #72（`feat/42-idf-skeleton`）里，两边 README 需要合一次）。
  4. `firmware/esp32s3/tests/test_pack_assets.py`：38 项，覆盖容器布局、解包越界、
     网页同源裁切、几何对位、落板取帧区间与 idle 自动选段、预算阶梯和端到端
     （真跑 ffmpeg 验 466×466 baseline YUV420，并断言 7 MiB 下落到 10fps、
     四段帧数是 25/41/40/41、总字节不超预算）。
- **关键实现决定**：
  - 取景框**不夹紧**。网页 `scale` 小于刚好铺满时露出的底色是片段 `bg`，夹紧会让整幅
    画面位移（`thinking` 的 `ty=+6.2%` 顶部约 22px 底色），人物和问号就跟网页对不上。
  - 渲染用**一次仿射重采样**（`Image.transform` + `fillcolor`），不是「整数裁切再贴回」；
    后者会把取景框取整，实测让中心偏 10px。改完与逐像素逆映射的偏差从 14.35 级降到 6.79 级，
    剩下的差只是重采样方式不同。几何用标记点核对：手算 241.01/239.61，渲染 241.0/239.5。
  - 预算到最低档仍超就**退出码 2 且不写文件**，并打印逐段大小和「去掉 extras 后是多少」。
- **C酱 拍板（2026-10-19 晚，Flash 确认 16MB 后）**：assets 分区放大到 **12 MiB**，
  打包预算 **11 MiB**（留 1 MiB），app 3 MiB + NVS。**四段都用网页同款的完整片段**，
  idle 直接用 4.65–9.90s 整段，不再截子段——不再需要在「有眨眼」和「首尾闭合」
  之间取舍。自动选段（`--auto-idle-range`）保留但不设为默认。
  **8MB Flash 的备用方案**：`--budget-mib 7 --board-range idle=4.65,7.15`。
- **实测（本机，gpt，11 MiB 预算，起始档 Q80/12fps 一次通过）**：合计
  **10,750,445 B = 10.25 MiB / 211 帧**，占预算 93.2%，余量 783,891 B（765.5 KiB）：
  `idle` 5.25s/63 帧/3,033,931 B；`listening` 4.04s/49 帧/2,806,269 B；
  `thinking` 3.96s/48 帧/2,525,184 B；`speaking` 4.04s/49 帧/2,312,696 B；
  `offline` 静态/33,485 B；`error` 静态/37,046 B。
- **备用方案实测（7 MiB + idle 截 2.5s）**：6,809,405 B = 6.49 MiB / 149 帧，93.2%。
- **断网 / 出错的静态图（`--status-dir`）**：`gge-offline.png` / `gge-error.png`
  各 1 帧、`fps=1` 的独立片段 `offline` / `error`，整幅缩放 466×466（不套角色
  裁切）。文件名前缀默认取角色名，gpt 的素材叫 `gge`，用 `STATUS_PREFIX` 映射，
  可用 `--status-prefix` 覆盖。
- **背景：为什么之前要截 idle**：整段 4.65–9.90s 不是闭合循环，「有眨眼」和
  「首尾闭合」不可兼得；`--auto-idle-range` 只按首尾差最小会挑出几乎静止的一段
  （6.90–9.65，动作峰 8.14 级）。7 MiB 预算下只能取舍，现在预算够了就直接用整段。
- **TF 版（`--profile tf`）**：板子和 TF 卡今天都能测，两条路一起准备。
  TF 包**不设体积上限**、Q89、四段完整 + 六个待机小动作
  （`curious`/`doze`/`happy`/`pout`/`shy`/`yawn`），帧率用 `--fps` 指定。
  **默认 24 帧**（源片原生，不是插帧），12 帧只作对照包。实测 gpt：
  24fps 是 **10 段 / 998 帧 / 63,408,933 B = 60.47 MiB**，每帧平均 62.0 KiB；
  12fps 对照是 **10 段 / 503 帧 / 31,944,485 B = 30.46 MiB**，每帧平均 62.0 KiB。
  gemini / grok 各 7 段 / 675 帧（45.19 / 48.69 MiB）——它们只有 3 个小动作，
  不是 6 个。
  逐段最重是 `listening` 的 **73.8 KiB/帧**，最轻是 `doze` 的 54.5 KiB/帧——
  板端解码测速要按 `listening` 算，别按整体平均算。
  格式与 flash 包完全相同，读端按名字查片段、不要假设段数。
- **两套预设的关系**：`flash` 是保底（11 MiB/Q80/4 段），`tf` 是精细版
  （不设限/Q89/10 段）。参数 `--budget-mib/--quality/--fps/--extras` 默认取
  profile，给值即覆盖。
- **2026-10-19 晚 rebase 到 #81 之后**：`BOARD_PLANS`（按角色）和 `PROFILES`
  （按用途）是两件正交的事，都保留；`select_segments(character=...)` 负责挑角色
  方案，`--profile` 负责挑预算/画质/帧率/小动作。rebase 前后 gpt 的 TF 24fps 包
  sha256 完全一致（`68c5b0bc…`），可以拿它当「打包确定性」的对照。
- **边界与安全**：未启动子 Agent；未动 8796 进程或配置。分支最初基于
  `origin/main`（`7e8473ae`）新建；#78/#79 落地后 main 为 `ad6e15dc`，本分支
  rebase 上去只保留增量（`--board-range`、`--auto-idle-range` 与 range/full 取帧
  模型，PR #80），本页数字以 PR #80 分支为准。

## 2026-10-19：#53 G哥专用说话视频与 6 段待机小动作接入（分支 feat/53-round-screen-idle-variants，未合并）

- **背景与目标**：落实 C酱在交接中的指示，为圆屏原型接入 G哥（`gpt`）的专用说话视频与待机插播小动作：
  1. 接入 7 段素材至 `prototypes/device-ui/assets/characters/gpt/`：
     - `speaking.mp4`（720×720，4.04s，专用连续张闭嘴说话循环视频，彻底消除此前说话视频缺失警告）；
     - 6 段待机小动作：`curious.mp4`（采用重做的 v4 版，排除 -old）、`doze.mp4`、`happy.mp4`、`pout.mp4`、`shy.mp4`、`yawn.mp4`。
  2. 待机小动作调度逻辑：
     - 仅在 `idle` 状态且动画开启时按 20–45 秒随机插播一段；
     - 同一动作不连续播放两次（随机池剔除上一段动作）；
     - 状态一变（例如按住说话 `listening`、`thinking`、`speaking` 等）立即打断并重置；
     - 单段动作播完（或接近末尾 0.05s）自动回归普通 `idle`，绝不循环播放；
     - 修复视频图层交叉淡入切换时的竞态条件（消除旧图层 timeupdate 在新 clip 生效前误判导致提前触发动作结束的缺陷）。
  3. 开发栏控制台：增加 `cn-idle-variant` 试看下拉框（含自动/各动作即时预览）。
  4. 清单与构建：更新 `manifest.json` 追加 7 段视频 sha256 与规格条目；运行 `build.py` 同步 `index.html`、`screen.js` 与 `screen.css`，`build.py --check` 一致性通过。
  5. 自动化测试与高保真证据：`prototypes/device-ui/test_device_ui_events.py` 扩展至全量 27 项通过（涵盖专用 speaking 校验、6 段小动作列表、happy 触发、listening 立即打断、连续两次随机不重复、真实后端 /device/desk-gge/screen 路由端到端触发校验）；生成包含小动作状态的真实浏览器截图 `test-artifacts/09_state_idle_variant_happy.png`。
- **边界与安全**：未启动子 Agent，未修改或重启运行中的 8796 服务。基于 `origin/main`（`565d5013`）开新分支，单独提 PR。

## 2026-10-19：8796 只读冒烟工具与真人验收指南（未合并）

- 交付只读冒烟脚本 `companion/tools/smoke_device.py`：
  - 纯只读模式（0 轮次创建、0 语音提交），安全探测运行中的 8796 服务；
  - 覆盖首页、普通设备页、圆屏 HTML、`screen.css`、`screen.js` 与 `/api/devices`（全 200 OK 校验）；
  - 自动校验 `release-source.json` 与运行中的部署记录匹配（commit `decef9be`）。
- 交付真人全流程验收指南 `docs/ACCEPTANCE_8796.md`：
  - 严格按「打开圆屏 → 按住说话 → 原会话接续 → 播放 → 停止 → 失败提示」标准化全链路撰写；
  - 详述各环节的圆屏视觉反馈、状态机流转、按键文案以及出现异常时在 `server.log` 中的精确排查行与关键字。
- 验证：在当前运行的 8796 实例上实际执行 `python3 companion/tools/smoke_device.py`，15 项检测全部 PASS（15 PASSED, 0 FAILED）；无子 Agent，未动 8796 进程或配置。

## 2026-10-19：#23 Codex 生命周期测试 thread.started 前置超时（调查，未部署）

- 本机复现结果：**0/236 失败**。`TestClose_ForceKillsProcessGroupAfterGracefulTimeout` 单项 `-count=40`、`-count=200` 全过；`-race -count=30` 全过；6 个测试进程并行 + 8 个 CPU 满载进程加压 `-count=6` 全过；Codex 整包 `-count=5` 全过；bridge 全量 `go test ./...` 跑 3 轮，`agent/codex` 均 `ok`。仍未复现 #13 那次偶发。
- 时序测量（8 次采样）：从 `Send` 到 `CurrentSessionID()=="thread-close"` 为 min 4.9ms / p50 10.5ms / max 263ms。5 秒阈值约有 500 倍余量，因此“超时”更可能是假 CLI 根本没有跑到打印那一行，而不是读取慢或调度慢——但原测试没有留下任何能区分这两种情况的证据。
- 本次改动（只动测试，不动产品代码，不放大阈值、不跳过用例）：
  - `waitForThreadID` 超时时输出假 CLI 的 PID、假 CLI 实际走到的阶段（`script.start` / `script.thread.started.written` / `go.send.returned`）、会话看到的 thread id、`alive` 与在册进程数。已验证：用一个“只启动不打印”的假 CLI 跑，失败信息为 `seen="" alive=true tracked_cmds=1` + `script.start pid=…`，可直接判定卡在“脚本已启动但没打印”。
  - 两个 Close 用例补 `defer cs.Close()`：假 CLI 会留一个 `sleep 30` 孙进程握着 stdout，原测试在 `waitForThreadID` Fatal 时不 Close，进程组不会被杀，失败用例会继续在后台跑满 30 秒并给同一次 `go test ./...` 加压。
- 结论：根因仍未确定；下一次真实失败会自带阶段证据。未改产品代码，未部署。
- 边界：本机沙箱禁止写 `~/Library/Caches`、`~/.cursor` 和 pty，`agent/acp`、`agent/iflow` 的全量失败属环境限制，与 #23 无关。

## 2026-10-19：#73 客户端等待播放权（已合并至 main decef9be）

- 普通设备页、圆屏页和模拟终端均区分合成完成与获准播放。ready 但没有播放权时保留原轮次、继续查询并续租；页面显示“排队等待播放”，获得播放权后自动开播。停止/放弃/释放不再进入排队或恢复旧音频。
- 新增终端回归及双浏览器验收：原生 create_device_app HTTP 路由，模拟 Bridge/TTS，真实 Chromium 媒体播放；A 正在播、B 排队、A 完成后 B 自动开播，以及排队时停止后不晚播。没有注入播放状态、替换路由或代替客户端刷新。
- 验证：Python 全量 449 passed / 1 skipped（包含 4 项双浏览器排队/停止用例），Node 播放器 34 passed，圆屏原生入口 E2E、构建一致性均通过。修复前终端与两个页面的排队回归均失败。验证命令与边界见 docs/DESKTOP_DEVICES.md。8796、真实 CLI、真人麦克风及板端均未操作；合并由 C酱处理。
- 后续补齐三入口混合验收：两张普通设备页 + 一张圆屏，A→B→C 自动接播、每页仅一次提交；新增用例 1 passed，原有四项浏览器用例亦通过。该补充只修改测试与文档，不改变客户端实现。

## 2026-10-18：#33 发言权接入设备入口（未部署）

- `DeviceRoom` 从 #43 的单槽房间锁拆成两层：`active` 只做**全局播放槽**（同一时刻只有一路声音，按接纳顺序交接），`slots[device_id]` 管**每台设备自己的**录音、请求与收尾。另一台在播或在收尾不再挡住这台设备的麦克风；同一台设备自己还有未结束轮次时仍然 409。
- 一次只跑一路识别/合成仍是管线容量（`service.transcribing`、`service.active`），拒绝时给出明确原因，不静默丢消息。`service.active` 要等整个 run 结束才清（生成 + 合成），不是开始播放就清，所以文案是“另一台设备的回答还在生成，请稍后再问；本轮未发送。”按设备拆开以后真正能并行的只有“别人在播的时候我可以录音和提问”（见 DESKTOP_DEVICES.md）。
- 发言权按设备分开：`floors[device_id]` + `currents[device_id]`，世代编号也按设备各自计。**跨设备不互相取代**：B 提问不会把 A 已生成好、还没开播的回答判成过期；A 按接纳顺序播出，B 排队等播放槽。取代只在同一位伙伴内部发生，且已经停止/出错/失联的轮次保留原标记，不会被下一问改标成 `superseded`。
- 每次真人新轮次被接纳时**先 `decide` 再 `_submit`**：`decide` 返回没有回答者就直接 409，Bridge 一条输入都不会收到；`_submit` 失败时 `floor.stop` 掉这一代。轮次真正释放时 `review_reply` 写 `floor_review` 事件（`play`/`insert`/`archive`/`mark`）。
- 取舍：跨设备的新问题不取代旧回答，已开播和未开播的回答均保留，按接纳顺序播放；同设备被取代的未开播旧回复仍归档。
- 快照新增 `playback_owner`；`device_released`、`config.active_turn`、`roles[].available` 全部改为按设备含义。`devices.py` 新增 `DeviceRegistry.availability()`，把设备到伙伴的映射交给发言权，不从当前说话人猜。
- 回归：`tests/test_voice_device_floor_integration.py` 扩到 10 项（跨设备不取代、按接纳顺序都能播、decide 拒绝时 Bridge 零输入、停止标记不被改标），并把 6 个旧“房间共享”断言改成新合同（允许另一台提问、但只允许一路出声）；`test_voice_device_protocol.py` 的共享房间用例改写为按设备录音 + 播放排队。
- 边界：跨进程（8793 普通页、讨论页）没有共享播放锁；真机共用麦克风/扬声器时的物理互斥属于 #42。未部署 8796，未做真人麦克风与实体板验收。

## 2026-10-18：额度开关与非阻塞探针组合审核（#65 / #59，未部署）

- #65 已合并（182629e3）：关闭额度显示时跳过探针，保留模型/上下文；审核中复现热更新与尾注读取的数据竞态，改为 atomic.Bool，新增并发回归修前 -race 失败、修后通过。
- #59 同步包含 #65 的 main 后，按 agent/模型缓存成功额度、后台刷新与失败保留旧值；额度与 CUJ 的 -race 测试、core/config/cmd vet 通过。两条组合验证保留额度关闭时零探针调用。
- 本次仅代码审核与合并准备，没有改运行配置、部署或重启桥接。

## 2026-10-18：圆屏落板准备：帧序列轻量化方案与 Cursor 候选形象（Issue #53 / PR #70）

- 大豆包（G酱）在独立工作区分支 `feat/53-esp32-board-assets` 针对 1.75" 466×466 圆屏完成落板方案（[docs/BOARD_ASSETS_PLAN.md](BOARD_ASSETS_PLAN.md)）：
  - 核心选型：Baseline JPEG 序列流（12 fps, Q=80），整套 4 种状态 126 帧约 4.93MB（thinking 采用户 10-18 指定的 0.00s–3.96s 全循环含问号原片，48 帧约 2.21MB）；
  - 网页圆屏：thinking 默认改为含问号全循环（中性起步→歪头问号浮现→平稳复位中性，首尾无缝闭合），GPT/Claude/DeepSeek 首尾平均像素差（MAE）低至 10.84 / 22.18 / 21.03 px，保留开发栏对照；
  - 硬件适配：ESP32-S3 无独立 JPEG 硬解，采用乐鑫 `esp_new_jpeg` 库的 Xtensa SIMD 矢量优化软解（理论估算 ~7–10ms/帧，待到货实测）；双缓冲 848KB PSRAM；
  - 导出工具：交付 `prototypes/device-ui/tools/export_board_frames.py`（支持显式路径、`FFMPEG_PATH` 环境变量与 PATH 探测，捕获 stderr 显式报错）；
  - 角色设计：给出 Cursor 3 组候选外观（机能极客猫 / 几何浮空灵 / 复古代码侦探）供用户决选，暂未生成图像文件；
  - 状态：PR #70 已提交，未改动 `companion/` 源码，未动 8796 守护进程，无子 Agent。

## 2026-10-18：PR #54 麦克风启动竞态修复（未部署）

- G哥固定页面 a6fb4cab、服务端 7da2c18、测试 d27ebf48 做浏览器验收时，首次主流程未上传录音。随后延迟真实 getUserMedia 返回稳定复现：松手后停在 thinking，迟到麦克风轨道仍 live。
- 为每次采集加世代校验，松手/取消使待启动采集失效，迟到流立即关闭；无音频明确显示错误并允许重试，不再无请求地停在思考。原测试套件补真实麦克风延迟回归。
- 修复后延迟复现通过（error、轨道 ended、无轮次投递）；#69 HTTP/浏览器验收 9 passed。语音识别、回答和合成使用模拟后端，不代表真人麦克风或板端验收。未部署 8796。

## 2026-10-18：圆屏 UI 解决 G哥 评审项（彻底移除路由兜底、失联租约过期两段展示与严谨真实入口验收）（Issue #53 / PR #54）

- 大豆包（G酱）在分支 `feat/53-device-ui-prototype`（PR #54）完成 G哥 的评审要求，严格遵守文件边界（仅修改 `prototypes/device-ui/` 及其文档，零改动 `companion/voice/device_app.py`、`devices.py`、`device_server.py`）：
  1. **主干合并与冲突解决**：
     - 将 `origin/main`（`ac3a108a`，含 PR #68）合入分支，彻底解决 `docs/STATUS.md` 与 `docs/HANDOFF.md` 的合并冲突，无残留冲突标记。
  2. **失联心跳停止 / 租约过期（`lease-expired` / `abandoned`）两段界面提示与恢复**：
     - 圆屏 UI 在轮询 `pollVoiceTurn`、释放等待 `awaitDeviceRelease`、服务重连与事件接收中全面接入 `result.abandoned`、`result.abandon_reason` 与 `last_release.reason === 'lease-expired'` 检测；
     - 第一段（失联提示）：触发时立即停止音频播放、退出轮询、切入 `error` 阶段并在状态栏显示「连接中断，本轮已放弃 · {detail}」（对齐 G哥 与 Grok PR #69 的「没有心跳 / 占位已释放」文案），绝不停留在 thinking 或继续 speaking；
     - 第二段（释放恢复）：服务端占位释放后，点击主按键可一键重置错误状态并安全回归 `idle`，支持立即发起新一轮真实问答，旧回复绝不重播。
  3. **彻底删除测试中自行添加替代路由的兜底（缺少原生路由明确失败）**：
     - 在 `prototypes/device-ui/test_device_ui_events.py` 中彻底删除 `screen_index`、`screen`、`screen_asset` 及 `if not has_native_screen` 的替代路由注入逻辑；
     - 明确断言 `has_native_screen`：当 `create_device_app` 缺少原生圆屏路由（如当前未合并 #66 的分支）时，测试立即显式抛出 `AssertionError`，绝不自行兜底伪造通过。
  4. **完善分块合成音频防御与播放器保护**：
     - 在 `source.html` 中修复 `synthesizing` 状态下分块到达时提前设置 `turn.audioData`，并在 `DeviceQueuePlayer.select` 与 `selectTurnAudio` 增加对象防空保护，消除任何未定义对象引用隐患。
- 验证结论：
  - `python3 prototypes/device-ui/build.py --check` 一致无误；
  - `prototypes/device-ui/test_device_ui_events.py` 前 12 项原生单元/事件断言全部 PASS，端到端浏览器部分如实校验原生路由并在缺少时明确拒绝；
  - 在 Grok #69 独立真实入口验收测试（`companion/tests/screen_acceptance`）中，当前页面顺利通过全部 7 项真实浏览器轮次用例（包括 `test_expired_lease_shows_abandoned` 两段验收）；
  - 临时测试环境使用 `tempfile.TemporaryDirectory`，零残留脏文件。

## 2026-10-18：圆屏 UI 移除假 1.5s 定时器，全面接入真实语音生命周期（Issue #53 / PR #54）

- 按任务分工，大豆包（G酱）在分支 `feat/53-device-ui-prototype`（PR #54）完成圆屏原型从假时钟模拟到真实语音生命周期的重构：
  1. **彻底移除假 1.5s 思考定时器**（`thinkingTimer = setTimeout(..., 1500)`），UI 状态流转不再依赖任何内部计时跳变。
  2. **全面绑定真实语音事件**：
     - 按住说话麦克风录音或 `startListening()` → `listening`（倾听）；
     - 松开提交转写或开始推理 → `thinking`（思考），且在音频真正生成前持续停留，绝无假超时；
     - 接入内嵌队列播放器（`DeviceQueuePlayer`）与实体音频通道 `<audio id="cn-voice-audio">`，首个有效音频分块出声播放（`audio:playing` 或 `playback:state` `playing`）时才真正切入 `speaking`（说话）；
     - 音频流全部分块完整播放完毕（`completed` 或 `audio:ended`）后回到 `idle`（待机）；
     - 409 占用 → `busy`；请求/转写/TTS失败 → `error`；网络不可达 → `offline`；网络恢复 → `idle`。
  3. **收尾防竞态与释放合同对齐**：
     - 点击「停止本轮 / 停止回答」立即切入 `stopping`（正在收尾），使旧会话序号与迟到音频回调全部失效；
     - 对齐 PR #61 的释放合同，轮询等待 `device_released !== false` 且全局空闲确认后再放开录音入口并回归 `idle`。
  4. **严格遵守文件边界**：所有修改仅位于 `prototypes/device-ui/` 及其文档，零修改 `companion/voice/devices.py`、`companion/voice/device_server.py`，未干扰运行中的 8787 / 8793 / 8796 服务。
- 自动化验证与产物：
  - `python3 prototypes/device-ui/build.py --check` 严格同步；
  - 新增 `prototypes/device-ui/test_device_ui_events.py`，12 项真实 Chromium 浏览器端对端断言全部通过（涵盖 2.2s 停留防自动跳变、各状态驱动、停止防竞态与异常分支）；
  - 导出高保真截图与 8 种状态截图至 `preview.png` 与 `test-artifacts/`。

## 2026-10-18：466×466 圆屏设备 UI 接入高清视频与交互收敛（Issue #53 / PR #54）

- 按用户要求在独立工作区 `/path/to/conest-53-ui-v2`（基于最新 `49f87a30`，完整保留 15 段原片与 2 段 GPT 正方形裁切版）重构[圆屏设备 UI 原型](../prototypes/device-ui/README.md)。收敛为单一推荐头肩特写方案，同时提供 1:1 真实硬件尺寸（`466×466 px`）、`1.35×` 放大查看（`629×629 px`）以及与旧 `192×208` 图集方案的同屏对比视图。
- 解决现有界面最影响体验的 3 个问题：① 用 `720×720` 高清视频加逐角色逐动作校准表（`scale / tx / ty / bg`）及圆周径向柔化层替换旧 2.9 倍放大图集，消除面部模糊、底部横切线与内嵌灰框边线；② 将顶部连接与名字合并为极简徽章（`● G哥 ⚙`），待机时隐藏「我在」状态框、仅保留底部低干扰 `按住说话`，非待机阶段按需显示状态胶囊与细微光环，避免挤占五官、龙角与帽饰；③ 引入单调递增 `sessionSeq` 会话令牌与双缓冲 `<video>` 交叉淡入（配合内存 `Blob` 预取与强制静音 `muted + defaultMuted + volume=0`），确保思考或说话时点「停止」立即进入 `stopping` 且绝不被旧计时器切回说话。
- 保留一机一伙伴的产品定位（圆屏内仅打开本机设置，开发用 `gpt / claude / deepseek` 切换与思考问号取舍放在顶部开发预览栏），诚实标注素材缺口（G哥缺专用连续说话视频，当前截取 `idle-blink-square-v2.mp4` 6.4s–9.4s 开口动作作候选；三组带问号思考视频默认截取 `0.0s–1.18s` 无问号凝思段并支持切换对比原片），保留 `fywdy / chatgpt-chibi-pets` 署名、CC BY-NC 4.0 与非官方声明。
- 已验证：`python3 prototypes/device-ui/build.py --check` 一致；Chrome 实测 `466×466` 与 `629×629` 尺寸、全 `<video>` 静音、各状态区段寻址、按住说话→松开思考→点击停止 1.8s 后防回跳竞态、设置页滑块及 `1440/1024/768/320px` 无横向溢出通过，控制台 0 报错。未验证：未接真实麦克风、TTS、8793/8787 生产服务或 ESP32-S3 实体硬件解码与触控。

## 2026-10-18：补充DeepSeek思考动画（Issue #53 / PR #54）

- 用户提供并明确指定思考视频，按实际带问号的画面命名为 deepseek/thinking-question.mp4；720×720、约4.04秒、24fps、1条音轨。12帧解码/目视确认歪头、问号和复位；原件与副本SHA-256一致，未转码。
- [素材目录](../prototypes/device-ui/assets/characters/README.md)及manifest已更新：15段原视频＋2段GPT裁切版，共17段。保留来源文件名与抽帧预览；仍只归档，未接入UI或硬件，循环及音轨听感未验收。

## 2026-10-18：GPT两段宽屏视频裁为正方形（Issue #53 / PR #54）

- 按用户要求新增 idle-blink-square-v1/v2.mp4，原1280×720居中取x=280、y=0、720×720，不缩放；原片保留。用AVFoundation最高质量重新编码，实测两段均720×720、10秒、24fps、1条音轨。
- 每段解码12帧并目视检查，脸部、头发、龙角没有因新裁切被截断；已更新[素材目录](../prototypes/device-ui/assets/characters/README.md)、预览、转换参数及来源哈希。现有14段原件加2段衍生版；仍未接入UI或硬件，不宣称无缝循环已验收。

## 2026-10-18：用户视频素材归档并按动作命名（Issue #53 / PR #54）

- 用户要求将 Downloads/素材 上传私有 GitHub，并根据内容重新命名。新增[角色动画目录](../prototypes/device-ui/assets/characters/README.md)：GPT 5段、Claude 5段、DeepSeek 4段，共27,710,013字节；保留下载目录原件，仓库副本按主要动作命名。
- 逐段以AVFoundation读取元数据、解码12个时间点并目视检查；新增抽帧预览、原名对照、SHA-256及尺寸/时长清单，复制后的14段哈希与源文件一致。仅抽帧检查，没有试听、逐帧、无缝循环、圆屏或板上验收。
- 所有素材含音轨，后续UI应静音素材并用实际TTS；思考动画带问号，GPT宽屏v1/v2动作相似，尚未确认GPT专用说话动画。尺寸为720×720、1280×720或544×544，背景及人物比例需统一。不得把归档视为界面清晰度已验收。
- 仍在 feat/53-device-ui-prototype 草稿PR #54；原型继续使用旧图集，本次未接入或部署。下一步先选择素材做466×466圆屏预览，再验收循环和声音驱动。具体生成工具与各文件提示词记录不全，保留fywdy来源、非官方声明及非商用美术约束。

## 2026-10-18：圆屏人物模糊反馈，高清素材待生成（Issue #53 / PR #54）

- 用户认为角色模糊，提出可考虑用 Gemini 生成视频。原帧实测192×208，当前大头单帧约显示560px宽，约2.9倍放大；原型没有blur滤镜。此前浏览器交互通过不代表用户认可清晰度。
- 内置imagegen参照原角色生成高清头肩像，返回401认证错误（没有可用凭证）；未生成或替换任何图像，未使用替代付费API。保留旧图集和界面代码，没有用CSS锐化假称已修复。
- 本轮继续在 `feat/53-device-ui-prototype` 更新草稿PR #54，仅补充[高清素材规格及母图/循环视频提示词](../prototypes/device-ui/ASSET_BRIEF.md)。下一步先生成并确认高清母图，再做动作和设备资源评估；用户尚未认可新素材。保持署名/非商用许可与非官方声明，保持已确认角色身份。

## 2026-10-18：圆屏 UI 原型入库，交给其他 AI 审核（Issue #53）

- 用户要求将已讨论的 UI 推到私有 GitHub，交给其他 AI 审核、重构、优化。本轮独立工作区 `/path/to/conest-device-ui`，分支 `feat/53-device-ui-prototype`，基线 `fd51fd5e923c900a25f29e2cd247e6f60b62815d`；未使用子 Agent，交付草稿 PR，不自行合并或部署。
- [原型入口与接手清单](../prototypes/device-ui/README.md)保存“大头特写 / 全身铺满”、G哥固定形象、已有图集动画与模拟交互。`source.html` 与对话原型逐字一致；随库外壳与 Python 构建让其他 AI 无需 Codex 也能预览、修改。素材固定 SHA、许可与原始 NOTICE 已保留；Cursor 形象未定，不猜配。
- 用户已订购一块带喇叭的 Waveshare ESP32-S3-Touch-AMOLED-1.75，尚未确认到货。先验证单板，最终双设备陪伴目标保持。此目录不接真实语音/CLI/硬件；不要把状态动画、模拟连接或1.5秒计时当成产品能力。
- 本机构建一致性、JavaScript语法、浏览器图片加载/换帧/方案切换、键盘说话→等待→回答→停止、离线设置与滑块、320px布局通过；详细范围见原型 README。只做同一 Agent 自查，独立审核与板上验收未发生。现有 CI 不覆盖此原型视觉，最新提交的 bridge/companion 结果以 PR 为准。
- 下一位先从 `source.html` 检查触控/文字/圆形裁切和状态事件，再逐步整理遗留样式或替换导出外壳；保持角色放大与动画方向。优化后重新生成 `index.html`、复核预览并更新本交接。真实状态接口与资源预算另按 #42/#43 推进；不接管其他写者的硬件协议文档。
- 未改 bridge/companion、私密配置、8793/8796服务，未发Discord消息、未刷固件。临时预览仅用于本轮自查；使用者按原型 README 在自己的电脑启动。
## 2026-10-18：PR #66 审核修复收尾（未部署）

- G哥接手核对并提交已留在工作区的三处修复：先判断活跃租约是否到期再清理历史记录，避免超过两倍租期后重置计时；圆屏入口重定向到 `/screen/`，使相对资源路径正确；用同源外置 `__coqin_device.js` 初始化配置，保留严格 CSP。
- 原审核复现和租约、长播放、屏幕路由测试共 21 项通过。Python 全量 428 通过、2 跳过（真实 ASR 未配置、该环境未安装 Playwright）；Node 播放器 34 通过。浏览器专项另用本机已安装的 Playwright/Chrome 验证，结果记录于 PR。
- 此处只是服务端修复；#54 页面和 #69 浏览器测试仍须固定各自提交做集成验收。未部署、未重启 8796，未派子 Agent。

## 2026-10-18：发言权评审后续（PR #62，未接入、未部署）

- 回应 C酱对 `136da1a5` 的审核（review 5562581156）。上一轮只把 main `3026ef88` 合了进来，没有改这四项。仍在草稿 [PR #62](https://github.com/Zssan12/conest/pull/62)，分支 `cursor/floor-control-33-0d68`。没有改 `devices.py`、`device_app.py`、`device_server.py`、`discussion.py` 或圆屏界面，没有子 Agent，没有动运行服务或部署配置。
- 判重只保留正文、点名、群体模式及来源、当前设备伙伴。同一轮次在预算已被扣掉、或目标伙伴转入收尾后重发，仍是 duplicate，回答者保持第一次的决定，`calls_authorized` 为 0。内部 `speaker()` 与返回的回答者一致。
- `review_reply` 用 `play` / `insert` 管播放和当前对话。过期但曾授权的正文仍 `archive`，`mark` 为 stopped 或 superseded；一轮既被新问题取代又随后停止时标 superseded。没有授权过的伙伴不归档。`is_current` 不再被解释成连共享记录一起丢。
- `PartnerAvailability.state` 分为 available / busy / unavailable。busy 的原因写「上一轮仍在收尾」，不叫「不可用」，也不改叫下一位。
- 文档写明：任何新的 `HumanUtterance` 都会使当前轮次失效，只能由按住说话或确认发送构造，不能来自声音活动检测、喇叭回声或伙伴消息。播放仍只锁播放；录音和请求不锁到播完；识别容量另算；房间占位留到集成时按 #43 拆。#33 不因本步关闭。
- 验证：Linux。companion `uv run python -m pytest -q` **380 passed / 1 skipped**（`test_voice_floor.py` 46 passed；跳过项仍是未设 `YIJIAZI_VOICE_REAL_MODEL` 的既有本地合成/识别冒烟）。评审复现改为 `retry : gge dup=True rejected=False calls=0`，`speaker()` 仍是 gge。Node 播放器 **34 pass**。bridge `go test -tags no_web -p 1 -count=1 ./...` 退出码 0，各包通过。未部署。

## 2026-10-18：发言权离线模块（Issue #33 第一步，未接入、未部署）

- 本线从 main `024763ea` 建 `cursor/floor-control-33-0d68`，草稿 [PR #62](https://github.com/Zssan12/conest/pull/62)。只新增 `companion/voice/floor.py`、`companion/tests/test_voice_floor.py`、`docs/FLOOR_CONTROL.md`，并更新架构、状态、首页索引和本交接。没有改 `devices.py`、`device_app.py`、`device_server.py`、`discussion.py` 或圆屏界面，没有子 Agent，没有动运行服务或部署配置。
- 调度按显式输入决定唯一回答者：默认当前设备伙伴；点名则只叫被点名的那位；只有真人显式开启群体模式才允许一位补充一次，无人补充是有效结果。预算用尽、不可用和重复事件不换人、不再次授权。停止或新轮次使旧世代失效，`is_current` / `reply_is_current` 拒绝把过期回复插入新对话。上限在 `FloorLimits`。
- 文档建议：播放继续全局互斥，录音和人类新一轮不要跟这把锁绑到播完。播放和硬件转向跟唯一 `speaker()`；人类新轮次使旧世代过期并丢弃迟到回复。当前 `DeviceRoom` 单槽占位保持原样。#33 不因本步关闭。
- 已将 origin/main `3026ef88` 合入本分支（其历史上还有 `5f3f2c11`：#58 C酱额度探针信任弹窗、#64 大豆包长回合停滞；以及 #63 局域网监听与每设备独立凭据）。第一次合并唯一冲突在本交接文首，两条记录都保留，main 的代码与 C酱交接原文未改。第二次合并无冲突，`devices.py`、`device_app.py`、`device_server.py` 按 main 原样进入，本线没有再改它们，也没有改 `discussion.py` 或圆屏界面。发言权模块仍未接入服务。
- 验证：同步到 `3026ef88` 后在 Linux 重跑。companion 全量 pytest **369 passed / 1 skipped**（`test_voice_floor.py` 35 passed；比同步前多出的通过项来自 main 上的设备凭据测试；跳过项仍是未设 `YIJIAZI_VOICE_REAL_MODEL` 的既有本地合成/识别冒烟）。Node 播放器 **34 pass**。bridge `go test -tags no_web -p 1 -count=1 ./...` 退出码 0，各包通过。未部署。

## 2026-10-18：导入角色小家代码到 role-household/（Issue #67，未部署）

- 本线由用户侧 Claude 在临时克隆的 feat/67-role-household-import（基线 main 0e906d4）只新增 role-household/ 目录与本条记录；不改 bridge/、companion/。
- 内容等于 role-household 本地仓库 85795de 的 git archive，去掉 docs/evidence、docs/screenshots（运行日志与对话截图留在 Git 外）。公网地址已脱敏，未含 token。
- 验证（在原仓库）：97 个测试全过；两轮独立代码审查已修完；2026-10-18 21:49 外网网页真跑，三个角色按网页回执轮流出声，同时最多一个在播。本仓库 CI 不跑该目录。
- 未部署。#56 分工仍是草案；queue-player.js 拷自 companion，许可证仍按 #9。

## 2026-10-18：C酱额度尾注「额度查询失败」（Issue #57，未部署）

- 本线 Claude 在临时克隆的 fix/57-claude-usage-trust-dialog（基线 main 1320bc90）只改 bridge/agent/claudecode/claude_usage.go 与其测试；无子 Agent，未碰 ~/cc-connect 或其他 conest 工作区。
- 根因：Claude Code 2.1.301 信任弹窗默认光标在「No, exit」，探针回车即退出（exit status 1）；且新版用 CSI G 排版单词，探针终端模拟器不识别，弹窗文字粘连检测不到。修复：支持 CSI G/d；按 ❯ 所在行用方向键移到「Yes, I trust this folder」再回车；弹窗未渲染完或屏幕为空时不发键；探针改用固定目录 <data_dir>/claude-usage-probe，只需信任一次，不再每次往 ~/.claude.json 加一条临时目录记录。
- 验证：bridge 全量 go test -tags no_web 通过，vet/构建通过；新测试在旧代码上失败。本机真实 claude 2.1.301 连续 3 次 GetUsage 均返回会话/周额度（每次约 3.2—3.7 秒），~/.claude.json 只新增 1 条固定目录记录。此前排查留下的 3 条 cc-connect-claude-usage-* 临时目录信任记录未清理（用户配置，未擅改）。
- 跟进（同日，分支 fix/57-footer-usage-nonblocking，叠在上面分支之上）：部署 b62782a2 后探针成功但需 3.0—5.8 秒，超过尾注 3 秒超时，仍显示「额度查询失败」。改为尾注不等探针：按 agent+模型保留上次成功额度，旧于 60 秒在后台刷新（20 秒超时，每个 agent 同时最多一个探针，失败 30 秒后才重试）；刷新失败不覆盖旧值（超过 30 分钟的旧值不再显示）；从未成功且最近一次失败才显示「额度查询失败」，首次探针进行中显示「额度查询中」（首次最多等 0.5 秒）。core -race 连跑 3 次通过，bridge 全量 no_web 通过（claudecode 的 TestForceKillCmd_KillsGrandchild 全量并发下偶发失败一次，单独 20 次均过，与本改动无关）。未部署。
- 未部署、未重启 cc-connect。部署需用户授权：合并后从 main 的 bridge/ 构建新二进制，备份并替换 ~/cc-connect/cc-connect 后由负责该进程的流程重启；验证 C酱尾注显示「额度剩余 N%」。已知余项：周额度重置时间解析为 0（reset 文本格式未覆盖），不影响尾注百分比。

## 2026-10-18：与角色小家的跨项目分工草案（Issue #56，仅文档，待双方确认）

- 用户（zuiho-kai）授权本线试协作者的提 PR 与合并流程。本线由用户侧 Claude 通过 GitHub API 在分支 juzi/collab-note 提交，基线 main fd51fd5e；只新增 docs/ROLE_HOUSEHOLD_COLLAB.md 和本交接，不改源码、配置或运行服务，无子 Agent。
- 草案：频道、全局发言锁、硬件归 role-household；语音输入输出复用 companion/voice，经 role-household 频道的文字接口接入。这是待确认的跨项目边界，不是已定架构；双方确认前，#33、#42、#43 的设备与发言协调边界保持不变，不按草案改实现。
- 待确认项见 Issue #56：许可证（#9）、companion/voice 是否拆包。确认后再同步 docs/ARCHITECTURE.md。未部署。

## 2026-10-17：电脑固定双设备入口（Issue #43，未部署）

- 用户认可当前8793自然度和停顿后，确认下一步电脑模拟G哥、Cursor各自一台设备。本线Codex独立工作区 /path/to/conest-43-desktop、feat/43-desktop-devices，无子Agent。已复用并同步原协作线合并的PR #47/#48/#50，并保留PR #51的新产品说明；没有改写它们的工作区。
- 新入口voice.device_server读取三份显式配置，两个固定伙伴页面共用一个房间占位，直到真实生成收尾及播放回执才释放。忙时拒绝、不排队；停止/迟到回执、错设备、重复页面不能恢复播放。复用原VoiceService/分块播放器与共享记录，语音不重复发送Discord。接口、启动和失联恢复见[电脑设备](DESKTOP_DEVICES.md)。
- 本机Python322通过/1真实ASR跳过、Node34通过；假桥接/测试WAV的双独立浏览器分别播放自己分块，停止立即暂停且不续播。并发脚本前置竞态造成的首次超时已保留；最终软件证据和限制见专属文档，CI/审核/合并看PR #52。此为同一Agent实现与自查，不声称独立审核。
- 生产8793/8787及桥接未因本轮重启，未改私密配置、未调用真实伙伴或发Discord消息。本次不关闭#43：真实CLI新入口、真人麦克风、硬件、联网认证和掉线恢复仍需单独验收。当前仅本进程排他；不要同时在旧8793和设备入口安排声音。下一步按独立发布/预览记录接真实伙伴，再按#42接两台硬件。

## 2026-10-17：GitHub 首页与产品目标对齐（Issue #8，文档侧线）

- 用户要求重构 GitHub README、澄清目标。本线独立工作区 /path/to/conest-readme-8，分支 docs/8-product-readme，基线 main 56517620；仅修改 README、GOALS 和本交接，不接管 #43 桌面集成，也不修改源码、配置或运行服务。
- 首页围绕“一位 AI 一台设备，首个展示为 G哥与 Cursor 两台、电脑承载后台”重组为交付目标、输入输出、已有证据、阶段路线和开发入口。GOALS 同步去掉设备形态待定的旧方案；按 #8 最新正文保留语音指挥工作与可复现交付标准。PR #36 简化来源称谓的意图已纳入，未改动或关闭其分支。
- 已核对 GitHub 目标/状态、#4 听感反馈及 #47/#48 状态：电脑原型有真实样例；当前音色反馈可接受不等于真人麦克风完整验收；硬件、设备联调、自由接话和语音任务闭环不写成已完成。编写期间 #48 合入 main 36ebe8f5，本分支已同步，并将首页旧默认值警告改为显式配置入口与实际部署边界。详细进度仍以各自 Issue 为准。
- PR #51 首轮两项 CI 通过后，精确 SHA 合并因 main 新增 #47 被门禁拒绝；已同步 e619eb2c，首页将设备路由明确为离线模块已合并、服务和真机集成未完成。未绕过门禁，最终提交重新检查。
- 文档相对链接、命令出处与差异已核验；最终审核、CI 和合并状态见关联 PR。本轮只发布文档，不部署服务，无子 Agent。后续功能线同步 main 时保留本目标定义，旧交接中的单设备/形态待定表述仅是历史记录。

## 2026-10-17：分块语音已部署8793（Issue #45）

- 用户“继续”授权本轮部署现有演示入口。工作区/path/to/conest-issue-39，ops/45-deploy-streamed-voice；仅文档变更，无新功能、无子Agent。下面Issue #39的“未部署”为开发时历史快照。
- 11:11:22正常停止旧8793 PID21408，固定发布8110ebaafb792fc07175eed32a13dc4bf39f9d91到~/.cc-connect-maomao/voice/releases/，新PID89429（操作前重查）。沿用现有配置/名单、G哥和Cursor原会话、Qwen音色和共享目录；Go桥接PID84453及单伙伴8787 PID12680保持。备份、启动命令、日志、回滚见[发布记录](VOICE_STREAMING_DEPLOYMENT.md)。原源码工作区不作为服务cwd，可继续文档PR而不改变运行代码。
- 旧8793环境缺少mlx_whisper，本次使用现有yijiazi Python3.12完整语音环境；新版219项Python通过/1跳过，另实际加载识别模型。上线ASR用合成音频经/api/transcribe验证关键短语正确，4.171秒；不是麦克风验收。未下载模型、未改全局依赖。
- 真实现有CLI+Qwen+浏览器完成两伙伴五段74块；原生事件顺序无重复/重叠、全段播完才推进，五段均提前首播。热态合成到首播0.784—1.004秒，首次worker4.145秒；AI文字仍19.738—50.349秒。每段原绑定、共享5个finished/5个advance/1个completed通过；Discord检查窗口新增0条消息。完整证据仅本机.local/deploy45-*，不公开原文/音频/环境。
- 唯一监听、页面和三份JS与发布文件一致，原配置/权限/桥接二进制/两旧进程保持。无回滚；回滚脚本有精确PID、空闲和旧源码检查，不可盲目重跑。文档最终审核、CI与合并见Issue #45关联PR，合并不要求再次部署。
- 下一步：用户从8793普通页或/discussion试听；人工确认自然度、断句间隙和麦克风，再按#33推进必要时接话和安静。没有实现自由抢话、预热、硬件或开机自启；新机器部署仍依赖旧环境与配置目录（#2）。

## 2026-10-17：分块合成与提前播放（Issue #39，尚未部署）

- 用户授权继续按Issue→PR→合并推进并使用子Agent。本轮选择减少多AI轮流语音的首声等待；独立工作区/path/to/conest-issue-39，分支feat/39-streamed-voice，基于main 9c403ca4。两个子Agent在独立worktree实现合成协议和共享播放器，父Agent实现服务接口、整合与浏览器验收；交叉审核完成、两位均回收。
- Qwen在合成中逐块交付，两页面单播放器按序提前播放，完整WAV可重播。完整合成和完整播放均确认后才推进讨论；停止、失败、旧请求不会偷偷续播或叫下一位。独立审核发现thinking回执绕过和停止后块仍可下载，父Agent先复现再修复并获只读复核。
- 本机219项Python通过/1项真实ASR跳过，34项Node通过；新CI强制运行播放器测试。真实本地Qwen+模拟桥接五段58块完整播放、原生播放事件无重叠/重复，后四段从合成到首播0.630—0.673秒；冷加载仍3.861秒，普通页首轮更慢。模拟阻塞合成时首块可播，停止后不恢复/不推进。完整数字、红绿/采样失败与限制见[分块语音](VOICE_STREAMING.md)，最终提交CI/合并以本Issue关联PR为准。
- 首个实体目标已对齐为多AI陪伴；GOALS/STATUS及Issue #33更正。上一轮同伙伴双向续聊和Cursor读共享语音的真实样例已补入状态表，私密证据在conest-issue-26/.local/manual-memory-20261017-2c0157a3.json；未重复调用真实伙伴。
- 本轮不部署、不重启生产桥接/8787/8793。本分支已同步main 8f60890f并保留PR #40的大豆包错误修复，只有交接文首冲突；生产发布以旧统一交接最新记录为准，勿从未同步的旧cc-connect源码重建覆盖。测试8794/8795使用独立记录和模拟桥接，收尾关闭。下一步核对发布条件后部署语音入口并收集真人听感，再按#33验证有必要才接话；硬件尚未采购。

## 2026-10-17：有回答的工具失败（Issue #34 后续，待PR与部署）

- 用户已授权本线修复、PR、合并及部署，不派生或联系子Agent。工作区/path/to/conest-34-tool-error，fix/34-tool-error-answer，基于包含模型发现PR #37/#38的main 9c403ca4；不修改别的工作区及模型发现文件。
- 00:38原生轨迹证明本轮manage_task试图kill已DONE、exit0的命令任务；后续最终回答DONE。修复把EventError.Content与安全原因分开，正文正常展示、失败提示另列，真实失败、语音API failed、队列/历史及额度语义保留。任务状态指引只减少无效kill，不承诺原生CLI不会再发生竞争。
- 旧代码回归红，新代码定向绿；macOS串行全量Go、原TCP审批、完整CUJ、相关race及hook整包race、vet、构建通过，最终SHA CI随PR记录。额外回归确认stream已出现失败时，即使原生快照变干净也不能改判成功。说明与边界见[有回答的失败回合](ANTIGRAVITY_TURN_FAILURE.md)。同一Agent自行实现和自查，无独立审核。
- 生产现场核对为9c403ca4，二进制哈希ecaec92fc867121ca09edb9726ae890ec6c7d5ece6e9ea9710345c56388eae41；此为开发前快照，部署前仍须重查。最终发布与真人验收分别记录在Issue #34及/path/to/yijiazi/docs/HANDOFF.md。

## 2026-10-17：模型 list→set 连续查询失败（Issue #5，后续修复待发布）

- PR #37 已于01:24部署并读到13个原生模型，但用户后续 list成功、set失败。日志01:36:23记录原生发现被终止；旧日志不足以确定是超时/取消/外部终止，外层stream ERROR也未独立归因。
- 已通过真实 Agent/Engine + 第一次成功、第二次失败的 CLI fixture 复现相同误报。新增同环境成功列表60秒内存复用、环境/过期边界、空列表独立报错与安全诊断。未知ID仍拒绝，模型仍到下一轮才应用。
- 分支 fix/5-model-discovery-snapshot，工作区 /path/to/conest-5-models-gge；同一Agent实现和自查，无子Agent。定向回归、相关race/完整CUJ、vet与构建通过；串行全量在测试进程umask=022下全部通过，首次077的daemon fixture前置失败保留。真实CLI隔离 list约7.94秒、随后排队校验约0.54毫秒，原模型保持。完整验证见[模型发现验证](ANTIGRAVITY_MODEL_DISCOVERY.md)。
- 本次后续源码尚未部署；未切换任何生产伙伴，未更改权限、配置或原会话。真人下一轮切换仍待验收，不能把隔离排队或一次列表成功当作闭环通过。

## 2026-10-17：Antigravity 模型列表来源修复（Issue #5，未部署）

- 用户授权修复 `agy models` 已有目标而桥接拒绝切换的问题。独立工作区 `/path/to/conest-5-models-gge`，分支 `fix/5-antigravity-cli-models`，基于 main `12ad8bd4`；本线自行实现和审核，无子 Agent。
- 显式 provider 模型仍优先，否则用同一 CLI/参数/目录/环境执行 `models`；去除公共 Gemini API 和四项旧静态兜底。超时或失败返回空候选，不伪造可用性。回归旧代码红、新代码绿；真实 CLI 读到13个模型，隔离 Engine 接受 `gemini-3.8-flash-high`，未切换真实伙伴。
- 最终 macOS 串行 Go 全量、相关 race/完整 CUJ、vet、构建和差异检查通过。首轮默认包并发有 Codex thread ID 等待超时，环境补测也曾因路径别名失败；原始失败与修复范围均保留，见[模型发现验证](ANTIGRAVITY_MODEL_DISCOVERY.md)。
- 未部署、未重启、未改生产配置/会话，也未改旧源码和其他工作区。Issue #5含其他后端验收，不因本修复关闭。下一步按 PR 审核/CI，再另行部署并在原伙伴下一轮确认真实模型。

## Issue #34：大豆包历史错误污染当前终态

- 已用 agy 1.4.0 的隔离会话副本复现：新回答已完成，但result复制历史地区拒绝错误；同条件新会话成功。不是额度耗尽，也不能用“有正文”直接改成功。
- 修复仅在本轮步骤完整完成、原生回答一致、错误精确属于历史时恢复正常终态；真实错误、空响应、未知/不可验证状态保留失败。不改权限或清空会话，不发Discord消息，不开子Agent。
- 红绿回归和真实适配器同会话两轮成功，额度查询正常；协议尾随换行导致的中间失败已保留并补回归。完整验证和边界见 [终态核验](ANTIGRAVITY_TURN_STATUS.md)。
- 本线从包含PR #30的main d6e8a035建立 /path/to/conest-issue-34，分支fix/34-agy-turn-status。只改Antigravity适配器、测试及文档，其他工作区未提交内容保留。
- 合并/部署与真人验收分别跟踪 [Issue #34](https://github.com/Zssan12/conest/issues/34) 及旧统一运维交接；不要把隔离两轮通过当成真人频道验收。发布前重新核对当前版本、空闲状态与权限显示配置，不能复用旧PID或整份回滚旧配置。

## 2026-10-16 23:44：真实讨论入口复核，PR #30同步最新主分支

- 已核对另一工作线23:35部署的PR #29：唯一桥接PID22719，二进制SHA256与其交接一致；G哥与Cursor绑定可查询、均空闲，session/agent pair仍与真实五段验收前一致。8787与8793配置接口HTTP200，无活动讨论。未重复重启桥接、覆盖其额度修复或发送Discord消息。
- PR #30在355c88c6上的两项CI成功后，因main合入PR #29/#32而出现交接文档冲突，精确SHA合并请求被拒，尚未合并。现同步origin/main 1460d811，保留两条工作线交接和全部业务代码；最终审核、CI与合并状态见PR #30。
- 同步后本机Python全量124 passed/1 skipped、讨论JavaScript语法与git diff --check通过；core的Input/完整CUJ/ErrorQuota定向race通过（7.119秒）。桥接代码与origin/main完全一致，额度回归没有被讨论改动覆盖。新的完整SHA仍须通过Ubuntu两项CI后才能合并。
- 8793继续运行已完成并发回归修复的讨论页面（PID21408），真实名单为G哥与Cursor，旧8787仍保留。讨论按两轮及总结推进，使用现有CLI原会话、现有Qwen和共享记录；真人可输入话题试听。Grok原会话缺失、Deep冷恢复能力与其他伙伴未验收的限制保持。

## 2026-10-16 23:35：PR #29额度尾注修复已部署，真人验收待完成

用户在暂缓后明确授权“合并部署”。PR #29按已审核提交ae71cdd8541faac0e4b27e4cb68d73546328c694合并为a884de2dbc001975e7348b7963eb4d22b0f4b7a6；两个源码树相等，macOS必要检查与最终Ubuntu CI均成功。发现G哥忙时等待，六伙伴及两个语音入口均空闲后完成备份、正常停止和原子替换。当前PID22719（操作前须重查），生产二进制SHA256为deb7fae10bfad53e63205ca8e356dcb8353a56b724fa31565dd3ceee71762206。

六Discord连接/API/配置/会话映射/调度定义和日志连续性检查通过，原权限与G哥yolo设置保留，未发Discord消息。备份、完整版本、回滚及真人验收方法见[额度验证记录](ERROR_QUOTA_VALIDATION.md#部署记录)。旧cc-connect工作树未同步，不能在旧源码目录重建覆盖。错误仍保留，CLI返回ERROR的原因尚未解决；Issue #28继续等待真人验证。下节“未部署”为发布前记录。

## 2026-10-16：Issue #28 失败回复的模型与额度尾注

独立工作区 `/path/to/conest-issue-28`，分支 `fix/28-error-quota`，基于main的3090217c，交付[PR #29](https://github.com/Zssan12/conest/pull/29)。用户明确要求修复大豆包额度显示。已复现：CLI返回ERROR及正文时，core错误分支跳过正常答案尾注；现复用会话模型与真实额度展示，同时保留错误、排队恢复和历史边界。回归修复前红、修复后绿，详见[验证记录](ERROR_QUOTA_VALIDATION.md)。

本机默认包并发Go全量、原TCP审批、完整CUJ、相关race、vet与构建全部通过，原始红绿日志保留于本工作区.local。自行审核，没有独立Agent审核；Ubuntu与合并状态以PR最终SHA为准。

不把非空正文当作SUCCESS，CLI错误原因尚未解决。主工作线Issue #27于23:11更新了同一个生产桥接，本次候选保留其已合并代码。用户确认主对话仍在部署/语音验收，明确要求本轮“先完成代码和PR”，因此当前不部署、不重启；后续上线前须重新核对唯一部署归属及伙伴/语音忙闲。当前未进行真人Discord验收，没有开子Agent，其他工作区和私密配置保持。

## 2026-10-16：两轮语音讨论真实CLI五段通过，PR #30收尾

- PR #25按已审核完整SHA79090166合并为3090217c；macOS整合core Input/CUJ race通过，Python113通过/1跳过，Ubuntu run38920520762两个检查成功。Issue #19已关闭；体验Issue #4仍开放。
- 用户要求直接接现有Discord讨论组CLI测试。Issue #27记录受控接入；六伙伴空闲后部署3090217c，旧PID76033→18026，二进制SHA256 c57b7555a9444b8ce9cc69032128f924fb2db291a80b85caad03d05f39272e08。六Discord连接、配置字节、六份active_session与agent_session_id映射保持，启动无ERROR/panic。备份~/.cc-connect-maomao/backups/voice-cli-20261016-231106/；旧单人8787保持运行，旧源码未覆盖。首个准备脚本因JSON结构读取错误在停止前退出，修正后核验；所有备份保留。
- 当前常规的Grok无具体CLI会话ID，严格入口409，不能替身新开。G哥/ Cursor有原绑定，独立8793用这两位+现有Qwen/共享记录进行真实五段讨论；五段已完成：G哥→Cursor→G哥→Cursor→G哥总结，每段session/agent ID均与起始绑定一致，真实Qwen非空音频且有完整播放回执。第二轮Cursor接受减少重复报名字的建议，保留声音相似时补报的分歧，G哥总结提出同文试听验证。检查窗口Discord新增0条消息；共享记录5个finished/5个advance/1个completed。原文/音频/会话ID只在本机.local/live-voice/。真人听感未评价。Deep虽有绑定，未声明冷恢复，不纳入此次名单。其他伙伴的可用性不外推。
- Issue #26实现位于/path/to/conest-issue-26，分支feat/26-voice-discussion。2—3位两轮+第一位总结，前文带作者，等待完整播放/显式跳过才派发，停止等待已送达任务收尾，失败不重发。最终Python124通过/1跳过。模拟8792浏览器五段播放/单播放器/自动播放拒绝/刷新恢复/跳过停止通过；独立真实8793的五段证据与模拟分开保存。真实轮次AI耗时13.653—39.378秒，TTS6.065—10.684秒，不包含浏览器播放时长。
- 本轮两位子Agent：Anscombe负责Go绑定修复并只读审核讨论后端；Nietzsche负责独立讨论前端。父Agent整合与测试；两个工作区分别conest-19-binding、conest-26-ui。独立审核发现停止与绑定I/O、转录与开始接纳两个P2交错；父Agent添加回归在旧代码复现两项失败后修复：停止意图先登记，发送前再核对，ASR与讨论共用接纳锁。真实五段发生在这两项并发防护补充前，之后重启独立测试页并以回归/模拟复核，不重复消耗真实模型。后端子Agent已独立复核两项修复关闭，限定范围无新发现；两位子Agent均已回收。没有让讨论伙伴自行派工；提示为限定建议讨论，不授予项目执行权限。
- 用法/限制见[VOICE_DISCUSSION.md](VOICE_DISCUSSION.md)。音频仍整段合成，没有实现预热/流式优化；真人听感与跨入口记忆逐项验收仍未完成。8793是显式独立测试入口，尚未替代8787。当前页面进程PID21408（须重查），运行本分支已修复版本；刷新后可开始新场。PR #30已创建并附当前聊天，最终SHA/CI/合并以GitHub为准。

## 2026-10-16：多伙伴会话绑定竞态已修，讨论与真实CLI验收继续

- 用户已授权开发电脑语音多伙伴讨论（Issue #26），并明确要求接入现有Discord讨论组CLI测试。先做2—3位伙伴两轮及总结，播放确认后推进，可停止后续派发；正文不重复投递Discord。
- PR #25合并前发现的GET/POST绑定间隙已修：语音携带预期session/agent pair，桥接在会话轮次锁内、登记请求与发送前核对，失配409且不占request ID。旧单人客户端兼容，成对参数与幂等性有回归。
- 子Agent独立worktree修Go并提交6484b2f，主Agent检查整合为e616e585；Python传参回归先失败后通过，完整113 passed/1 skipped。子Agent报告相关race、CUJ、串行Go全量/build/vet通过；主Agent整合验证与最新CI以PR记录为准。
- 现场只读核对：8787仍是G哥单人服务；生产桥接G哥绑定可用且空闲，Cursor/Grok/Deep/C酱/大豆包在/input/bindings均422。ACP多伙伴能力尚未部署，不能只改名单冒充已接通。当前服务PID76033，后续仍须重新核对。
- 讨论独立工作区/path/to/conest-issue-26，前端子任务/path/to/conest-26-ui；不混入PR #25。本节发布前未改生产配置/进程，尚未向真实伙伴提交讨论。

## 2026-10-16：TTS延迟实测，下一步先接预热与音频流式

- 已将用户反馈和完整计时补充到Issue #4；本轮仅诊断/实验，未修改业务代码、生产配置或进程，没有派生子Agent。
- 固定28字合成文本调用现有生产worker：首次13.067秒，同进程随后4.867/3.048秒。单独新进程的固定随机种子对照中，预热后整段输出3.349秒才有音频；stream=True、streaming_interval=0.64的首次/复核在1.069/0.610秒拿到首个非静音块，整段合成3.096/2.654秒。输出均6.24秒、24kHz且样本有限；这不是浏览器首声或主观音质验收。两种实验控制变量不同，不能相减宣称精确冷启动成本。
- 结论：当前库已有流式能力，先保持Qwen与现有依赖，服务启动预热后再接受对话，并打通worker→服务→浏览器的有序音频块；只加stream=True仍被整段WAV收集阻塞。须保留单任务/单播放器、请求及角色隔离、停止后旧块丢弃、失败不冒充完整播放。建议服务就绪后短句首次播放≤2秒作为下一步目标，尚未达成。AI回答20.9秒的等待是独立阶段，本步不改桥接完整回执合同。
- 可复核本机文件：.local/tts_latency_probe.py、tts-latency-baseline.jsonl、tts_stream_probe.py、tts-stream-probe.jsonl；试听产物tts-warm_full.wav与tts-stream_064.wav。实验命令/指标/局限见Issue #4补充；日志及音频未入Git。工作区当前仅docs/HANDOFF.md、docs/STATUS.md有本轮未提交文档改动；PR #25仍需先修下节的会话检查间隙，未合并或部署。

## 2026-10-16：真人单人语音反馈与合并前待修项

- 用户在本机8787入口测试后反馈“通过了”，但语音合成等待太长。记录为用户报告的单人流程通过；没有收到逐项验收记录，不据此宣布所有跨入口/跨角色记忆或音质已验收。用户准备咨询语音方案，暂未更换模型、配置或生产服务。
- 只读核对当前TTS：mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit，MLX-Audio 0.5.9 / MLX 0.32.4，uncle_fu，M3 Pro / 18 GiB。常驻worker按需首次加载，当前入口等整段WAV合成完成后播放，尚未流式播放。22:29:55的最近完成轮次：回答生成20.900秒，30字朗读文本合成13.804秒，服务端总计34.704秒；不包含录音/识别/用户确认时间，也不是稳定性能统计。仅记录计时，不复制对话正文或会话编号。
- PR #25仍是草稿、未合并、未部署。e14d93b7上的macOS串行Go全量、ACP/core全包race、构建、vet、显式CUJ及两项Ubuntu CI通过；Python113通过、1跳过。同步PR #20前因QQ外网fixture卡住的串行运行已中止，不能算通过；同步后的通过日志为.local/go-main-synced.log。
- 最后自查发现尚未修复的会话检查间隙：语音先GET绑定，再POST时只带session_key；期间Discord切换会话可能让输入送到新会话，当前回执核对只能阻止播放。合并前需要把预期session_id/agent_session_id带到POST，并由桥接取得会话锁后核对，补“查询后切换绑定不得发送”的回归。用户先体验现有单人版，本轮未继续实现此修复。

## 2026-10-16：多伙伴电脑语音（Issue #19，未部署）

- 用户选择“点名一位回答，可切换伙伴”。本版以页面选择实现，一次一位；口头点名、同时讨论、插话取消仍未实现。原单AI已有两轮记忆和播放实测，真人麦克风与完整跨入口验收仍按Issue #4推进。
- 独立工作区 /path/to/conest-issue-19，分支 feat/19-multi-voice。已同步PR #18的主分支改动；没有覆盖主目录未提交文件、Cursor负责的settings.py/初始化或其他PR。没有派生子Agent。
- 新增voice.multi显式名单入口、伙伴绑定状态、逐伙伴音色与播放反馈、共享记录角色归属；严格校验轮次回执。不自动发现伙伴、不初始化配置，原单伙伴入口兼容。用法、限制与后续部署入口见[MULTI_VOICE.md](MULTI_VOICE.md)。
- ACP新增严格恢复：失败/不支持不new，丢弃加载回放，核对sessionId和end_turn，RPC响应边界阻止迟到输出。复现并修复关闭与Send的事件通道竞争：修复前race/关闭通道发送失败，修复后50次-race通过。
- 真实独立Grok对话通过“记住测试词→关进程→严格恢复→回忆”，未使用生产伙伴绑定。Cursor/Grok初始化声明支持loadSession，DeepSeek未声明；不能把ACP适配器能力等同所有客户端都能冷恢复。Grok测试期间有402/429警告，最终测试成功，额度稳定性未保证。
- 浏览器用独立8791端口和模拟桥接/静音WAV验证A→B→A、忙时锁定、不可用角色禁发、停止后切换、单播放器；不是自然音质或真人麦克风验收。自动测试、真实CLI及真实TTS各层证据与最新CI以关联PR为准。
- 同一真实Qwen worker两种音色合成通过，样本留在本机.local/。Python完整测试113通过、1跳过。同步PR #18后的Go全量有一次删除结果卡片测试同步失败，已提Issue #24；原失败及后续串行/CI结果分别保留，未在语音PR顺手修改删除功能。
- 本任务未替换生产配置、未重启旧服务、未发送Discord消息。最终合并不等于部署。下一位先核对Issue #19关联PR与最新SHA、CI，再为真实双伙伴演示明确唯一操作人、实例配置和回滚；体验Issue #4保持开放。

## 2026-10-16 21:33：Issue #13 已由另一工作线部署，本线完成补充验证

核对现场发现 PR #18 已合并为 7027a4a15b1212379604819860eadb5bfc7c8028，并于21:26完成部署。当前桥接PID76033，二进制SHA256 f3acbb3e2fdebba6031c277a81dddba53582432a309503471a6a3e61325b845c；备份及部署记录在 ~/.cc-connect-maomao/backups/quota-20261016-212557/。本线已只读核对六个Discord连接、配置字节与六份会话映射；独立重建产物与生产SHA256完全一致；同步最新源码后的原TCP、完整CUJ、全量Go、相关race、vet和构建全部通过。不要用旧候选dd9d752f覆盖已经上线的额度功能，也不要重复重启。

PR #20（deploy/13-empty-response，/path/to/conest-issue-13-deploy）同步最新main，完整保留其业务代码，仅补审批合同回归、QQ/MAX/飞书本地HTTP测试隔离及验证文档。测试误连bots.qq.com和unused的根因已定位为fixture缺失，修复前网络保护明确报错，修复后通过；没有修改LuLu/权限策略。历史TCP监听限制已解除，原TCP、完整CUJ、默认并发全量Go、相关race和vet已在此前候选通过，同步后的相同检查也全部通过，详见[部署复核](ISSUE_13_DEPLOYMENT.md)。一次Codex假进程启动5秒超时没有稳定复现，保留原始失败与复核边界，未延长超时掩盖。

部署成功与真人验收分开：目前未发送Discord测试消息，仍待用户亲自对大豆包发起一次只读工具任务并核对正文/审批。先前独立验证提交07700992及红绿证据见[验证记录](ISSUE_13_EMPTY_RESPONSE_VALIDATION.md)，下文“未部署”是PR #18发布前的历史快照。

## 2026-10-16：大豆包空响应与额度状态（Issue #13）

本轮在独立分支 `fix/13-response-usage` 修复源码，关联 [Issue #13](https://github.com/Zssan12/conest/issues/13)，通过 [PR #18](https://github.com/Zssan12/conest/pull/18) 交付。未修改私密配置、旧源码或运行进程，未发送真实 Discord 消息；合并和部署均须另外核对，不能把以下测试当成线上已生效。

- 现场配置核对：大豆包走 Antigravity 的 stream-json；Cursor 走 ACP 且 auth_method=cursor_login。现已接入真实额度：Cursor 使用账期接口并按响应选择模型额度池；大豆包使用自己会话的 CLI 本地配额接口，覆盖 Argon 独立周额度。上下文占用不用于推算余额。
- 空响应证据：19:16:33 的本机 CLI 日志显示 print 模式对工具确认执行 soft-deny，同一时刻桥接把 11 字节的空响应占位符记为正常完成。源码在桥接已批准后返回 `allow`；[官方 PreToolUse 文档](https://antigravity.google/docs/hooks/) 说明该值仍委托默认权限策略，而 `auto_approve` 才表示已批准（仍遵守显式规则）。已修正转换，鉴权、用户拒绝和 pending request 校验保留；未启用跳过全部权限。
- 空结果兜底：没有非空白正文的 SUCCESS 转为可本地化的错误；不写成功历史、不自动重发工具任务。纯空白流片段不再遮掉最终正文。同一进程下一轮和引擎排队继续的回归通过。
- 额度反馈：普通消息、富卡片、缓存 token 状态行独立展示额度；明确区分“额度暂不可查询”“额度暂无数据”“额度查询失败”和真实剩余比例。查询失败不继续冒充上次成功余额；上下文仍按原有口径显示，额度带独立标签，遵守原有状态栏开关。
- 真实接口验收：2026-10-16 20:29 前，新代码分别成功读取当前 Cursor 模型所属池与 Gemini 4 Argon 周额度。Cursor 在 macOS 继承系统 HTTPS 代理，3 秒状态栏预算下查询成功；大豆包启动隔离空闲 CLI 验证本地鉴权/RPC后关闭，没有提交推理轮次。模型/Agent 缓存隔离、零额度、未知数值及周额度优先级有回归。详见 [额度查询说明](QUOTA_REPORTING.md)。
- 尚未验收：旧服务部署及真人 Discord 回归；Cursor 企业团队/PAC代理、Antigravity 非 stream-json 与其他操作系统。内部接口可能随 CLI 升级变化，失败时明确提示；不要将账户数据接口实测写成频道已上线。
- 已验证：旧代码的审批 relay、空结果/缺失额度、两个后端缺失 UsageReporter 回归均出现预期失败；修复后通过。Go 构建、vet、CUJ、相关竞态测试、按 CI 方式执行的全量（no_web、-p 1、-count=1）通过；两个真实接口只读验收通过。首次将全量与 race 同时运行时，Claude 孙进程重复 kill 出现 operation not permitted，Codex 进程重叠用例等待 thread id 超时；未改这些包，随后完整串行运行通过。原始日志留在本机 /tmp/conest-real-quota-*.log。更早同步 main 前的 launchd 等失败属于前序检查记录，已纳入 PR #14 基线。

恢复时先查看 Issue #13 对应 PR 的最新 SHA、CI 和部署记录。自动测试使用本地模拟 CLI/平台，另有显式只读真实账号验收；两者均未提交真实模型推理请求。不要将本轮自动化验证描述为真人 Discord 验收。

## 前序交接：Issue #15（已通过 PR #17 合入主分支）

- 用户要求试听GitHub候选CosyVoice。独立worktree：/path/to/conest-issue-15，分支experiment/15-cosyvoice，从已合并PR #14的b280972f开始；Issue #3已关闭。未修改主目录并行文档、PR #12/#16或旧生产配置。
- 已在M3 Pro / 18GiB本机用固定社区mlx-audio-plus源码与CosyVoice3 FP16生成4个WAV（短句首次/预热、安慰句、中英混合句），并用现有Qwen3-TTS生成同文对照。模型、环境和音频只在.local/cosyvoice/，不进入Git。源码、复现步骤与结果见[试听记录](COSYVOICE_TRIAL.md)。
- CosyVoice预热后三句耗时3.140/4.618/6.194秒，对照Qwen为3.232/2.928/3.815秒，只算合成；没有整体速度优势。两者音色不同，主观自然度待用户听。CosyVoice短句专名的ASR回查有歧义，不能写成全部发音合格。
- 初次完整加载因社区包间接缺torch失败，独立环境补齐并固定依赖后退出0。8个WAV验证、离线识别回查、依赖/语法检查已完成，原始失败保留。社区实现不是官方CUDA性能；未测流式/打断/真人麦克风/全链路。
- 本任务自行复核，未派生子Agent；PR最新SHA、CI和合并结果以Issue #15关联PR为准。生产仍使用Qwen，未重启服务或投递Discord。Issue #4保持开放，后续接入先看用户试听反馈。

## 前序交接：Issue #3（已合入主分支）

- 独立worktree：/path/to/conest-issue-3；分支fix/3-go-test-baseline，从origin/main的8c040812开始。主目录的未提交语音文档未修改。
- 已修复launchd测试隔离、Engine关闭时消息写盘竞争、OpenCode刷新回收/测试同步、CLI测试脚本启动延迟及模型查询命令参数丢失；Antigravity非零退出不再冒充成功。
- 代码提交8c860baf；[PR #14](https://github.com/Zssan12/conest/pull/14)交付。macOS全量（-count=1、默认并发）、构建/vet、关键-race/CUJ通过；Ubuntu [CI run 38894302371](https://github.com/Zssan12/conest/actions/runs/38894302371) 的Go全量及Python检查通过。根因、修复前回归和中间失败见[诊断记录](GO_TEST_BASELINE.md)。
- 本任务自行复核，没有独立Agent审核。最终文档提交仍须通过CI后按完整SHA合并；当前合并结果和Issue关闭状态以PR为准。工作区保留，未清理或覆盖其他任务文件。
- PR #10已在2026-10-16合并，Issue #1关闭。当前不操作旧生产配置/服务，没有部署。根目录仍可能存在其他任务的未提交文件，恢复时先核对。

以下保留前一阶段的导入与工作流背景；当前验证以本节及Issue #3的PR为准。

## 已确认目标

名称共栖 · CoNest。用户确认独立新目录、整理后发布 GitHub，仓库私有。产品目标见 [GOALS.md](GOALS.md)，能力事实见 [STATUS.md](STATUS.md)。本轮授权的是源码与协作流程整合，不包含运行迁移。

## 当前交付

新工作区 /path/to/conest；由 cc-connect maomao 克隆保留历史，bridge/ 导入当前桥接源码，companion/ 导入语音、活动、日报及测试。旧 Python 网页 demo 留在旧仓库。来源与基线见 [SOURCE_ORIGINS.md](../SOURCE_ORIGINS.md)。

初始导入时Python独立环境102项通过、1项跳过，Go构建通过；Ubuntu云端Go全量测试通过，但macOS当时失败。该历史失败已由Issue #3修复并完成双平台验证，详见状态表。快照复制后再次核对原源文件哈希，没有发现导入期间继续变化的文件。本地导入清单在 .local/import-manifest.json，未纳入 Git。

私有仓库 [Zssan12/conest](https://github.com/Zssan12/conest) 已创建并核对 private=true，默认分支 main，初始导入提交 e9f902d4。已建立 [Issue #1–#9](https://github.com/Zssan12/conest/issues)，入口见状态表。工作流通过 [PR #10](https://github.com/Zssan12/conest/pull/10) 交付：统一Agent入口、协作规则、模板、CI和主分支保护。本轮没有服务重启、配置替换、Discord投递或硬件操作。PR最新审核、checks与合并结果以GitHub为准，恢复前先核对分支和差异。

GitHub CI run 38889638594在0ed5b4f0上两项全部成功。本地actionlint、文档本地链接和git diff --check通过。main保护已通过API配置并回读：PR必经、bridge/companion检查绑定GitHub Actions且必须成功、分支与main同步、讨论已解决；包含管理员，禁止强推/删除，线性历史。仓库仅开放squash合并，保留分支。

PR #10只补充工作流文档、PR模板及仓库设置，已合并；Issue #3的业务修复单独在PR #14交付。当前所需批准数0，适配单账号协作；没有独立审核时须如实标注自查。具体步骤见CONTRIBUTING.md。旧源码和运行数据保留。

## 旧生产边界

- 桥接源码 /path/to/cc-connect，maomao；产品扩展 /path/to/yijiazi。
- 伙伴工作目录 /path/to/agents-demo；私密配置和运行数据 ~/.cc-connect-maomao/。
- 原详细运维证据在 /path/to/yijiazi/docs/HANDOFF.md；这里只记录接手所需索引，不复制会话正文或凭据。
- 2026-10-16 18:09:28 模型切换+子 Agent 共同版本已部署，历史PID80706；18:12六个bot只读查询通过。更早“候选待部署”记录已被该结果替代。
- 18:16活动主持人改为gge，18:19采集正常；21:00活动、22:00日报结果尚待检查。16:12/16:46脚本失败由用户确认也是额度不足，日志只证明exit1。
- 当前部署事实来自上述时间点的运维记录；恢复时重新核对进程与状态，不能把旧PID当实时值。

## 下一步

1. 恢复时核对Issue #15关联PR最新SHA、checks、自查与合并结果；试听音频在上述独立worktree的.local/cosyvoice/{cosy-samples,qwen-samples}/。先收真人自然度反馈，再决定是否接入。保护主目录未提交文件及其他PR的并行工作。
2. Issue #2配置可移植性由其他任务推进，先核对当前负责人；真实电脑语音/跨角色记忆仍按Issue #4验收。新任务按用户授权确定范围，试听实验不自动授权运行迁移。
3. 用小型真实项目验证Issue→分工→PR→测试审核。硬件采购放在电脑体验验收之后。

## 交给下一个 Agent

请先读 AGENTS.md、README.md、docs/HANDOFF.md；需要理解验收和边界时读 docs/GOALS.md、docs/STATUS.md、docs/ARCHITECTURE.md。核对当前分支、HEAD、未提交变化和实际Issue/PR，再继续一个有明确验收条件的任务。旧运行环境还在原目录，不把新仓库的构建视为已经部署；默认不启动子Agent，只有当前真人授权才派工。实质进展后更新本交接。

## 2026-10-20 G哥：#130 按句播放候选
- 独立 feat/voice-sentence-stream，叠在 #129；Claude voice_stream 和 companion sentence_stream 均默认 false。没有启用线上。
- companion 453 passed /3 skipped；核心/Claude 针对性 race 与 CUJ 通过；默认全量 Go、vet、build 通过（真实web构建产物与#129相同），日志 /tmp/conest-stream-go-default.log。
- 必须保留生产 #99/#101，再在隔离会话测真实首句延迟；ASR 只增加计时，不能报告五秒已解决。详见 docs/VOICE_SENTENCE_STREAM.md。

## 2026-10-20 夜间整合候选（未部署）

- 基于现场桥接 1cf4c0a1，保留 #99/#101/#120，并叠加 #129 ACP resume 和 #132 默认关闭的按句语音。网关沿用 7c3b33df；不把多频道 busy 聚合当成语音路由。
- 固件 1788efc（01e8b20 + #125 + #131 + 生命周期/空闲降帧修复）已编译，app 3,011,168 字节；补丁树一致性验证通过。仅准备 app-only 交付，未刷板。
- companion 460 passed/3 skipped；网关 46 passed；桥接全量 tests/vet/build 和 core/Claude race 通过。固件新增 ASan/UBSan 测试通过，全量主机测试仍有 1 项基线唤醒模型配置规范失败。
- 仍待：真实帧率/温升/光圈/语音验收，Grok relay、ASR 实际提速、畸形私密标签过滤。未重启服务或修改生产配置。
- 完整版本、资产校验、app-only 刷机与回退、现场验收步骤见 [OVERNIGHT_20261020.md](OVERNIGHT_20261020.md)。

## 2026-10-20 #139 评审修正（未部署）

- ACP 语音会话本身只认可 end_turn；覆盖新建/恢复、Send/SendResumed、截断/取消/拒绝/未知原因。澄清：转发器首轮此前已走严格发送，本轮复现的是语音会话普通 Send 的缺口，并补强该契约。
- 启动失败时仅在确定未调用 Send 且无已保存 native ID 时解除占位；保留失败请求回执，不自动重投。既有身份、发送后未知结果、重启未知身份继续失败关闭。
- 明确接纳失败的503带 submission=not_sent；companion 按此证据提示未发送，普通503/丢失确认仍只查回执。存储故障不能证明历史请求未发送，不带该标记。
- ACP合成协议与启动失败测试先红后绿；竞态/CUJ通过，companion476通过/3跳过。Go全量/vet/build见PR最新验证记录。真实CLI、设备、频道未测试。
- #135旧产物与校验和保留，#139依旧草稿；早上需重新构建匹配服务，夜间未部署、未重启、未刷板。

## 2026-10-23 Issue #54 向导头像与品牌收尾

- 首页五个字母圆标改为五个 bot 的 Discord 当前头像静态 PNG；Claude/Codex/Gemini/DSH/MiniMax 标签及悬停 CLI 名称可见。
- 登录后侧栏展开显示 bothouse、收起显示 bh；清理服务商卡片旧品牌宣传与 Slack 应用模板。上游依赖、历史文档和第三方邀请链接保留原值。
- 作者先前隔离验证：前端 lint、7 项测试、build 和 Go 沙箱全量测试通过；旧版本复现字母圆标及侧栏旧名，新版本验证 5 张头像、DSH 标签、明暗主题、390px 无横向溢出。
- 本轮按橘派活提交并集成 release/v0.1.3；集成后前端重新构建。尚未部署，最终验收交橘。

## 2026-10-23：本机 hook 同步（Issue #59）

同步前台等待、DSH sleep/轮询/只读查询规则、教训表提示、派活拒绝说明和承诺回放测试。保留 HOOK_PROXY/GATE_WIKI/HOOK_RESEARCHER_DIRS 等通用配置；DSH 辅助文件复用随包日志读取器，既有 run.py 接入会话字段并保留角色开关与 Stop 处理，不另注册兼容 hook。bash-guard matcher 增加 job_output。研究派活按已配置目录要求 researcher，未扩大为所有目录。测试夹具不读取作者定时任务。

Python 等待回归：main 的 bash-guard 对 18 个应拦案例放行，更新后通过。验证日志见 /tmp/hooksync；本分支仅实现与自查，draft PR 待独立验收，未部署。
