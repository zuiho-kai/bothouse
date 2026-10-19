# 当前架构

## 边界和数据归属

| 模块 | 职责与接口 | 为什么独立 |
| --- | --- | --- |
| bridge/core | Engine、会话、队列、本地 API、技能注入 | 跨平台编排，不依赖具体 agent 或 platform 包 |
| bridge/agent | 原生 CLI 启动、事件解析、模型/权限与会话适配 | 各后端协议独立演进，向 core 暴露能力 |
| bridge/platform | Discord 等平台的接收与发送 | 平台差异留在适配器 |
| companion/voice | 浏览器录音、本机识别、严格会话续聊、语音合成和共享记录 | 音频生命周期与 Discord 投递分开；通过本地 Unix socket 调桥接 |
| companion/autonomy | 时刻表、动作状态、消息采集、Markdown/HTML 和每日手记 | 活动计划与归档独立于模型会话；通过桥接 API 和 Discord API 读取/投递 |
| skills | 当前真人授权下的协作行为约定 | 让 bot 理解语义并调用现有原生工具；不是工具权限沙箱 |

源码由 Git 保存；模型会话由相应 CLI 与桥接会话映射管理；共享语音记录、活动状态及消息 SQLite 库在外部运行目录。凭据只属于本地私密配置，不属于 Git。

## 真实消息流

Discord 消息 → platform/discord → core/engine.go → agent 适配器 → 原生 CLI → 事件过滤与输出 → Discord。

失败回合可通过EventError.Content携带已有回答，Error只携带诊断；核心将两者分开展示，仍保留失败终态、错误钩子和队列恢复。回答不进入成功历史，本地/input不将其作为可播放的成功text。Antigravity只用自身CLI的认证当前轨迹分类安全原因，详见[失败回合说明](ANTIGRAVITY_TURN_FAILURE.md)。

语音录音 → voice/static → voice/app.py 的 /api/transcribe → speech.py 本机识别 → /api/turn → voice/bridge.py 本地 API → 所选伙伴原会话 → 回答正文 → 本机 TTS/浏览器播放。单伙伴入口默认 G哥；voice.multi 需要显式名单，同一频道、一次一轮。

roles.py 定义允许接入的项目与音色，VoiceService按project保存上一轮播放反馈并在提交/回执处核对绑定。TTS共用worker，音色作为每次合成参数传递。ACP适配器新增严格续接接口，冷恢复失败不new、加载回放不输出、错会话更新和非end_turn不成功；RPC读取边界关闭本轮事件窗口。具体协议与验证见[MULTI_VOICE.md](MULTI_VOICE.md)。core仍只依赖能力接口，不按厂商名路由。

语音轮次写入 voice/memory.py 管理的共享记录。同一伙伴接续原会话；其他伙伴按需查阅。语音使用隔离的输出通道，正文不再次作为 Discord 消息发送。没有会话恢复证据时应报告失败，而不是悄悄开一个新角色替代。

voice/discussion.py在单轮VoiceService之上管理有界讨论：开始时冻结全部伙伴绑定，两轮及总结，每段播放完成/明确跳过才派发下一轮；共同的提交锁和讨论占位排斥单人输入。停止不取消已送达CLI任务，需等待原回执再释放占位。前文以带作者的资料传给下一位，事件带discussion_id与阶段；完整合同见[语音讨论](VOICE_DISCUSSION.md)。

`tts_worker.py`通过带请求ID与序号的消息输出完整WAV块；`NeuralTTS.synthesize_stream`校验后同步回调，`VoiceService`在事件循环中发布块元数据和读取端点。两页面共用`static/queue-player.js`，边合成边顺序播放；合成成功与播放结束是两个独立条件，均满足后才能推进讨论。停止会使旧播放回调失效，已送达CLI的任务仍需收尾；协议、计时和验证见[分块语音](VOICE_STREAMING.md)。

设备模拟通过 `voice.device_server` 独立启动，`DeviceRegistry` 管理静态设备映射，`device_app.DeviceRoom` 管理每设备轮次槽、全局播放槽及每页归属。它复用VoiceService单条投递/合成/共享记忆链路，通用单轮/讨论API不挂载到设备服务，避免绕过占位。原会话固定、设备/轮次/页面校验和迟到音频拒绝发生在服务端；客户端复用录音和分块播放器。具体边界及失联恢复见[电脑设备](DESKTOP_DEVICES.md)。这不是硬件认证或跨进程音频锁。

`voice/floor.py` 是 Issue #33 的发言权调度，按设备接入上述房间，decide 先于投递，拒绝不产生 Bridge 输入。它只根据显式传入的点名、真人群体模式、设备绑定、伙伴状态（可调用、上一轮仍在收尾、不可用）和预算，决定唯一回答者以及至多一次补充。判重只看这句话本身。`is_current` 只拦住播放和插入当前对话；停止或被取代的已授权正文仍归档并标记。播放仍应同时只出一路；各设备轮次互不取代，回答按接纳顺序获得播放权；识别与生成/合成管线容量仍独立限制并发。客户端区分 ready（合成完成）与 playback_allowed（获准播放），排队时继续轮询，不把回答提前标成已结束。`HumanUtterance` 只能来自按住说话或确认发送。合同见[发言权](FLOOR_CONTROL.md)。

## 消息处理的关闭边界

Engine通过bridge/core/engine_workers.go登记消息处理工作；开始关闭后拒收新工作，取消上下文并关闭会话/适配器，最后等待已登记的消息、队列、压缩、事件读取和Send结束。因此这些工作不会在Stop返回后继续写盘。OpenCode自己负责取消并等待模型缓存的后台刷新；测试必须先Stop，再回收临时目录。

此等待依赖适配器响应取消或Close，不是强制中断任意第三方代码，也没有覆盖所有非消息后台任务。边界及回归证据见[Go测试基线诊断](GO_TEST_BASELINE.md)。

## 额度查询

core 通过 UsageReporter、ModelUsageReporter 与 UsageCapability 查询后端能力，不识别具体服务商名称。Cursor 的原生/ACP 适配器共用 bridge/internal/accountquota；Antigravity stream-json 会话只查询自己拥有的 CLI 本地 RPC。回复优先读取当前会话，核心回退缓存按 Agent 实例与回复模型隔离。认证、模型额度池和网络差异留在适配层，详见 [额度说明](QUOTA_REPORTING.md)。

## 活动和日志

autonomy/__main__.py 读取外部配置和历史状态，判断活动时段，通过本地桥接创建任务；采集已配置频道的消息，交给 journal.py 和 reading.py 生成归档与阅读页。日报保留原话归档，再尝试生成今日手记；额度不足不能写成成功。

当前主持人与普通 Discord 主 bot 是两个配置。leader 命令在既有锁内同步活动配置和 cron 归属，保留已有时刻与暂停状态；旧动作仍按原执行者核对。换模型/主持人不应清空历史重试。

## 模型与协作

模型切换说明在 bridge/core/skills/model-switch/SKILL.md，使用当前项目/会话环境先 list 再 set/effort/auto。只接受后端实际提供的准确标识；排队成功与下一轮已生效是两种状态。

子 Agent 使用原生 CLI 的真实能力。当前默认不派生，仅本次真人明确授权后最多两名、一层，父 Agent 收回并验收。约束见 skills/project-subagents/SKILL.md。多个 bot 共用目录不提供文件锁、任务认领或自动合并；人为分工与独立 worktree 仍然必要。

## 整合决策

本次把桥接与产品扩展放进同一仓库，因为一个功能经常同时修改 Go 和 Python，需要一个 PR 描述完整行为。保留 bridge 内部路径、Go module、CLI 名称及原 Git 历史，降低重命名风险并保留上游来源。

独立目录只接收源码，不替换运行服务。先完成配置可移植性与验收，再单独计划备份、切换和回滚。跨机器配置、多个硬件设备或多用户隔离确有需求时再调整边界。

## 原生压缩边界

core 通过可选 NativeContextCompressor 能力管理会话锁、排队模型、取消与用户反馈；Codex 适配器负责短生命周期 App Server 和严格终态判断。压缩操作不占用普通提示词通道，不创建替代会话。已有 ContextCompressor 文本命令接口继续用于其他后端。

ACP 的公开输出边界位于适配器通知入口：仅已知消息事件可生成正文，流式剔除显式私密区块后再交给前台/空闲消费者；裸summary隐藏，公开details内的summary与Markdown代码示例保留。不按模型或平台名分支。协议边界与无法识别无标记内部正文的限制见 [ACP_PRIVATE_OUTPUT.md](ACP_PRIVATE_OUTPUT.md)。
