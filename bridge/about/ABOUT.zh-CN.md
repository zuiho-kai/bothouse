# bothouse 是什么（给角色读的产品说明）

> 这份说明编进 bothouse 程序，`bothouse about` 会连同版本号和本机配置一起打印出来。内容取自仓库首页（README 的「能用它做什么」「团队怎么运转」「bothouse 和其他项目：重心不同」）和 docs/GOALS.md；发版时如果功能或对比有变化，要跟着更新这份。

## 被问到时怎么答

- 有人问「你是什么」「bothouse 是什么、能干嘛」「和 XX 比怎么样」时，按这份说明和下面打印的**本机配置**回答：先给结论和立场，再说依据，最后才说哪些没实测。
- 「我们这套」指的是这台机器上实际配好的角色和平台，不是通用介绍；照本机配置说有几个角色、各用哪个 CLI、接了哪些平台。
- 没亲自跑过对方的产品，可以说「这是按双方公开说明比的」，但不要因此拒绝下判断。
- 表里没有的项目：先按它公开的 README 归到下面某一类，再照同类的差别说。

## 一句话

bothouse 是跑在你自己电脑上的团队协作层：把你已经登录好的几种 AI CLI（Claude Code、Codex、Antigravity、DSH、Gemini CLI、OpenCode，Grok 等走 ACP 的也行）拉进同一个群，主角色拆活派活、大活交给工作区，全员共用一份 Markdown 记忆，每晚自己复盘。一个账号、一个模型也能建几个角色组队。

## 能做什么

- **一支自己的 AI 小团队**：每个角色有自己的名字、人设、会话和头像；角色包挑一个就能上岗。人设只管性格，在团队里干什么（主角色、工作区、副手）由桥按配置里的位置加一层标准职责。
- **在常用聊天软件里找它**：Discord 完整支持（多角色、@、派活交回、队友状态、斜杠命令）；飞书单角色；QQ 官方机器人手动配置；DSH 桌面版/网页版频道页实验中。
- **聊天不卡，大活另开**：主角色接话；预计超过 10 分钟的活交给「工作区」频道去做，做完交回，要拍板才回来问人。任务板记谁在做什么，每件活一个子话题；派给的队友额度冷却时自动改派给空着的队友。工作区可以用更便宜的模型跑（DeepSeek、本机千问），按每件活的交接自动选。
- **叫到才开口**：默认主角色接话，被 @ 或点名的才回；没点名的消息由轻量调度模型判断该谁接。
- **大家记得同一件事**：所有角色读写同一份 Markdown Wiki（基于开源 llm-wiki 扩展），Git 记每次改动；每轮只推相关页的标题和行号，要用再读正文；面板里的「记忆论坛」给每条记忆打分排序。
- **晚上自己复盘**：会话结束或闲置时记进度，夜里对照原话纠错去重；反复被纠正的地方整理成候选规则，人点头才生效。
- **每个角色的技能**：反复摸索工具的步骤可在夜里起草成技能，面板里查看、编辑、确认，再按角色启用；DSH 原生加载该角色已启用的技能，其他后端通过桥的技能命令使用。已有全局技能仍沿用原来的范围。
- **长任务不跑偏**：交接带用户原话；换一个干净上下文的 AI 验收；说「修好了」要附证据，说「稍后看」要挂定时器；危险命令有护栏。
- **每个成员自己的目录和 GitHub 授权**：开了以后，进群的人各有一个目录，用自己的设备码授权 GitHub，替他做的 GitHub 操作只用他本人的授权；角色换一个系统账号跑时，由系统拦住一个成员的活去读别人的目录和凭据。建团队时推荐，部署团队的人点头才开。
- **个人 agent 入队**：队员可以在自己电脑上跑自己的 bothouse，用自己的 CLI 和额度；主角色派活时附上团队里相关的经验，他们交回的经验进共享记忆。
- **在手机上管**：自带网页面板，看谁在忙、用了多少额度、改人设、换模型、给正在跑的活插话；模型和推理档位按频道分开记。手机不装 DSH，开着 Tailscale 在浏览器里输 6 位配对码也能连上。
- **桌宠**：每个绑定的角色可以有一只自己的桌宠，穿自己的形象，显示这个角色的状态和气泡，点它就能聊天。
- **硬件**：bothouse-iot 把 ESP32 圆屏小板接进来，当一个角色的身体。

## 和别家比：重心不同

**别家大多是一个 agent 带一群分身，或者一个要你搬进去的新工作台；bothouse 是把你已经在用的几种 AI 拉进你已经在用的群，让它们分工、共用一份记忆。**

| | 是什么 | 接哪些 AI | 几个 AI 怎么协作 | 记忆 | 在哪聊 |
| --- | --- | --- | --- | --- | --- |
| **bothouse** | **跑在你电脑上的调度层 + 网页面板** | **Claude Code、Codex、Antigravity、Gemini CLI、OpenCode、DSH；Grok 等走 ACP；OpenAI 兼容接口** | **主角色派活到独立工作区，任务板，每件活一个子话题** | **全员共用一份 Markdown Wiki，每晚复盘** | Discord、飞书、QQ、DSH web（实验） |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek 官方 agent 框架（开发者预览） | 默认 DeepSeek，也能加其他模型提供商 | 子 agent；团队模式在实验 | 没有内置长期记忆，可接记忆插件 | 自带桌面端和网页 |
| [Tobs](https://github.com/BotHarness/DeepSeekBot) | 基于 DSH 的 Bot 插件 | DSH 里配的模型 | 群里 @ 谁谁回，任务委派 | 每个 Bot 一个 Git 仓库 | 飞书、Slack、Discord、QQ、微信 |
| [DS Bot](https://github.com/Fei2411/DS-Bot) | 基于 DSH 的桌面 App / 插件 / Docker | DSH 里配的模型 | 主 Bot 带团队，群管理员统筹 | 每个 Bot、每个群各有记忆 | App 内 |

成熟的个人助手、工作台和编程工具：

| | 是什么 | 几个 AI 怎么协作 | 记忆 | bothouse 的不同 |
| --- | --- | --- | --- | --- |
| [OpenClaw](https://github.com/openclaw/openclaw) | 个人 AI 助手，Claude、Codex 等内核可插拔，能接 20 多种聊天软件 | 团队预设：一个协调者派给研究、写作、审稿 | 会话按 agent 分开；Memory Wiki 默认共用，可按 agent 拆 | 一个助手换内核 vs 几种已登录的 CLI 同时在一个群里分工 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | 会自己学习的个人助手，任意模型 | 隔离子 agent 并行 | 自管记忆、自动生成技能 | 它越用越懂你一个人；bothouse 让一个团队共用记忆 |
| [Orca](https://github.com/stablyai/orca) | 多 agent 编程 IDE，用你自己订阅的 CLI | 几个 agent 并排做同一件活，挑最好的合 | 交给各 CLI 自己 | 它让你盯着赛马；bothouse 让你交代完就走 |
| [LobeHub](https://github.com/lobehub/lobehub) | 开源 agent 工作台：网页、桌面、手机 App，云端或自己用 Docker 部署；40 多家模型提供商；能接入 Claude Code、Codex 等外部 agent；带 agent、MCP、技能市场 | Agent Team：顺序、并行、迭代、辩论；任务能派发、跟进、定时 | 结构化记忆，可查看、编辑、删除；资料库 | 它是一个要你搬进去的完整工作台（自部署要数据库等一套服务）；bothouse 是你电脑上的一个小程序，直接指挥已登录的 CLI，在你已有的群里分工，全队共用一份能直接改、Git 记录、每晚复盘的 Markdown 记忆 |

**怎么选**：想要一个随处能聊、越用越懂你的个人助手，OpenClaw 和 Hermes Agent 很成熟；想要一个功能齐全、带市场和多模型的 agent 工作台，LobeHub 更全；想同屏盯几路编程 agent 赛马，选 Orca；只用 DSH、想养几个 Bot，有 Tobs 和 DS Bot。如果你手上已经有几种 AI CLI，想让它们在你已在用的群里分工、共用记忆，睡前交代一句、醒来收结果，选 bothouse。这些项目很多能叠着用。

其他常被问到的：[Raft](https://www.testingcatalog.com/raft-1-0-puts-ai-agents-in-team-mode/)（新的类 Slack 工作区；bothouse 不用换软件、开源可自部署）、[Cindy](https://github.com/makecindy/cindy)（一个客户端挂几个 CLI；bothouse 由主角色自己拆活派活）、[腾讯马维斯](https://technode.com/2026/05/21/tencent-unveils-mavis-ai-assistant-that-turns-pcs-into-conversational-interfaces/)（系统级助手；bothouse 是几个 AI 分工做项目）、[magpie](https://github.com/yetone/magpie) / [cc-switch](https://github.com/farion1231/cc-switch)（管用哪个模型；bothouse 管谁接哪件活、大家记得什么，可一起用）、[llm-wiki](https://github.com/zuiho-kai/llm-wiki)（bothouse 的记忆就在它上面扩成多角色共用）。

## 还没有的（路线图）

抢活前先认领、按需拉起专家角色、角色包和插件市场、记忆跨电脑携带和语义检索、工作区自动清场、更多群聊平台（Telegram、Slack、企业微信等的完整团队模式）、全队一键同步规矩和技能、深度支持热门 DSH 插件。

## 更多

- 仓库：https://github.com/zuiho-kai/bothouse （首页 README、docs/GETTING_STARTED.md、docs/GOALS.md）
- 许可：Apache-2.0
