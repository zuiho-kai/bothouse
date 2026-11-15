# #1662 分析：DSH 插件里和桥重复的功能

结论：插件自己跑成员（DSH 原生会话 + 本机 CLI 的 ACP），所以围着成员的整套团队逻辑（任务板、接问退升、十分钟看门、一次性回查、工作区交回检查、额度冷却、记忆目录、gate 上下文、规矩文本）都在 JS 里又写了一份。桥本来就能把 DSH（`dsh --profile acp`）、Codex、Claude Code、Gemini 当角色跑，也能用 cloud_web 接进插件的频道（实验 exp1 实测：桥跑的小橙、小蓝在插件频道里派活跑通）。所以改法不是逐个接口转发，而是：成员改由桥跑，插件只留频道这一层。

| 插件里（删前行数） | 桥里对应 | 改成 |
| --- | --- | --- |
| dsh-member.mjs（1605）DSH 成员会话、提示词、规矩拼接、记忆块、gate 块、进度卡 | agent/dsh（ACP）+ core/agent_identity.go、team_mode.go、gate.go turnContext、memoryindex.go | 删；成员 = 桥的 dsh 角色 |
| cli-member.mjs（378）Claude/Codex/Gemini 的 ACP 接入 | agent/claudecode、codex、gemini | 删；成员 = 桥的对应角色 |
| tasks.mjs（1594）任务板、接问退升、交回验收、十分钟看门 | contrib/gate/board.py、core/team_idle_watch.go、handoff.go、relay_task.go、reply_task.go | 删；cloud_web 网关去掉 task 帧和 tasks 能力 |
| later.mjs（241）一次性回查 | core/timer.go（bothouse timer） | 删；网关不再往消息里塞回查命令 |
| team-exit.mjs（440）工作区 ask/report 检查 | core/team_exit*.go、core/team/exit_rules.go、contrib/lead/ws-up | 删；共享用例挪到 bridge/core/team_rules/testdata |
| handoff-rules.mjs + 拷来的 handoff-rules.json | contrib/lead/_handoff_rules.py、ws-handoff | 删；桥不再往插件目录写 handoff-rules.json |
| team-rules-file.mjs + 打包拷的 team-mode-rules.md / team-exit-rules.json | core/team_rules（go:embed） | 删；打包不再拷 |
| quota-cooling.mjs（174） | core/quota_cooling*.go、quota_scope.go | 删 |
| gate-context.mjs、memory-index.mjs、memory-sources.mjs | core/gate.go、memoryindex.go、contrib/gate | 删 |
| managed-skills.mjs、model-errors.mjs、approvals 里 DSH 成员那半 | 桥的技能管理、capacity_retry.go、权限卡（buttons 帧） | 删；网关保留 bot 的权限卡转发 |
| plugin.mjs 的 /later、/memory、/tasks、/workspaces、/team 路由 | bothouse timer、ws-handoff、bothouse workspace、setup apply | 删 |
| mentions.mjs（751）@ 解析，hub.replyRoute（回复给谁），approvals 的文字批准词表 | 第二批挪进桥：platform/cloud-web/mentions.go（逐函数移植，原 JS 测试录下的 986 条输入输出对照全一致）、hub_message.go（点名、回复路由、各 bot 读到的文字、发出时换成 @名字）；文字批准走桥 core/engine.go handlePendingPermission | 删。网关只转原文 + 房间成员名单（members）+ 引用（quote），桥判断谁被叫；桥用 permission_resolved 帧告诉插件关权限卡；页面画 @ 高亮/细光照旧（界面），对照表 client-ui-discord/tests/backend-mentions.json 由桥的 Go 测试核 |
| lead-state.mjs（30） | core/team.go 的 lead.json | 保留：它就是读写桥那份 lead.json（只剩转发） |
| team-status.mjs（179） | core/team.go 写的 team_status_dir/<project>.json | 留：只读桥写的忙闲文件给页面显示（转发） |
| store.mjs（975） | 无（频道房间、消息、工作区房间是 DSH 频道自己的数据） | 留，删掉残留：任务表（建表/迁移/进行中计数）、DSH 成员的会话绑定、投递任务（jobs）、读到哪的游标、会话重置和闲置工作区回收——这些是桥的任务板和桥自己的会话管的 |
| roster.mjs（335） | setup apply 的角色名单 | 留：频道成员名单的界面数据，经 bridge.mjs 交给 `bothouse setup apply`（转发） |
| member-management.mjs（71） | 同上 | 留：成员面板的 HTTP 接口（界面）；Codex 模型探测已在第一批改成指向桥的角色页 |
| personas.mjs + personas.json（桥 core/persona_presets.go 的拷贝） | `bothouse setup personas`（core/persona_presets.go） | 删；改调桥：bridge.mjs personas()，默认成员和加成员的人设库都从桥取 |

桥缺的接口（本批在桥里补）：
1. `setup apply` 角色带模型（role.model，DSH 写成 provider/model）。
2. `setup apply` 删角色（remove_projects，只删只接 cloud_web 的角色）。
3. cloud_web 的 allow_from 认请求里给的值（DSH 频道主人是 owner，不是 hub 的 user）。
4. 查不了用量的后端（DSH/ACP）额度不再永远「未知」，否则主角色永远不派给她。
5. cloud_web 工作区忙闲改由桥自己数（原来信插件报的进行中任务数）。
6. 派活规矩那句（让你派给队友就在最终回复里 @ 她、不写【接】）从插件挪进桥的规矩文本；删掉只对插件成立的「DSH 频道调 POST /collab/api/rooms/{id}/workspaces」「DSH 协作页照旧首行写 [report]」。
7. 读 DSH 模型设置时也看 web、desktop 两个 profile（插件单装用户在那里配模型）。

插件新增 bridge.mjs（适配层）：没 bothouse 就跑官方安装脚本装到 ~/.local/bin；把成员名单交给 `bothouse setup apply`；新角色热加载（/api/v1/reload），删角色重启（/api/v1/restart），桥没起就后台起 `bothouse --headless`。bot token 没配就生成一个存在频道数据目录。
