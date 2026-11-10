---
name: jiuwenswarm-extensions-video-duplex
description: 视频全双工扩展 video_duplex 文件导览：JoyAI 与 Qwen-Omni Realtime provider、SQLite 持久任务服务、extension.py、video_live.py、tasks/ 下 service/store/bridge 等关键文件职责
metadata:
  scope: 只收 video_duplex 应用插件的读码入口与关键文件清单；该扩展的审查规则归 extensions-plugins-rules，扩展框架归 jiuwenswarm-extensions，AgentOS 扩展归 jiuwenswarm-extensions-agentos
---
# 视频全双工扩展（video_duplex）

## 现状

- video_duplex 是一个应用插件，负责 Jiuwen Web 上的实时音视频问答，支持 JoyAI 与 Qwen-Omni Realtime 两类 provider，并提供共用的 ASR/TTS 适配。用户在通话中委派的任务会写入基于 SQLite 的持久化任务服务，再交给 Core Agent 执行，执行时通过根 Agent 回调和 E2A checkpoint 注入需求变更。
- **从哪里开始读**
- `jiuwenswarm/extensions/video_duplex/extension.py` — VideoDuplexApplicationPlugin 与 register_extensions：插件初始化和关闭、绑定 Web 频道、设置读写 RPC、WebSocket 路由、前端贡献
- `jiuwenswarm/extensions/video_duplex/backend/video_live.py` — register_video_live_handler：实时音视频问答的 Web RPC 入口（realtime 配置、JoyAI 帧、遥测、对话追加）
- `jiuwenswarm/extensions/video_duplex/backend/qwen_omni_gateway.py` — serve_qwen_omni_websocket：浏览器与 Qwen-Omni Realtime 之间带鉴权的双向 WebSocket 中继
- `jiuwenswarm/extensions/video_duplex/backend/task_adapter.py` — VideoSearchManager 的 handle_qwen_tool/status/list/answer/control，对接共享 Host 任务服务的 RPC 适配
- `jiuwenswarm/extensions/video_duplex/backend/tasks/server_adapter.py` — VoiceTaskServerAdapter：AgentServer 侧处理 checkpoint ACK 和任务产出文件的端点
- **关键文件**
- `jiuwenswarm/extensions/video_duplex/backend/tasks/service.py` — TaskService：任务的提交、修改、取消、重排、抢占、回答、进度持久化和并发调度，不依赖媒体层和 RPC
- `jiuwenswarm/extensions/video_duplex/backend/tasks/store.py` — TaskStore：用 SQLite 记录任务事实，并保证用户操作幂等（command/replay）
- `jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py` — VoiceAgentTaskRail：根 Agent 在模型调用前后和工具调用前的回调，注入语音委派任务的需求与身份
- `jiuwenswarm/extensions/video_duplex/backend/tasks/execution.py` — TaskExecutionBinding（继承 checkpoint.py 的 TaskCheckpoint）：绑定 Host 请求和输出租约，观察原生执行的结算
- `jiuwenswarm/extensions/video_duplex/backend/tasks/bridge.py` — GatewayTaskEndpoint/RemoteTaskEndpoint：通过 E2A push/ACK 通道下发由 Gateway 发起的 checkpoint 命令
- `jiuwenswarm/extensions/video_duplex/backend/tasks/interactions.py` — 校验信息类问题和原生审批问题的答案，并确保这些答案不会获得审批权限
- `jiuwenswarm/extensions/video_duplex/backend/tasks/prompts.py` — 面向模型的任务查询、回执和执行指令，以及简报 prompt；用户需求和结果按不透明数据处理
- `jiuwenswarm/extensions/video_duplex/backend/qwen_omni_tools.py` — Qwen-Omni Realtime 的工具定义，以及工具调用请求的解析和校验
- `jiuwenswarm/extensions/video_duplex/backend/joyai_provider.py` — JoyAI 的视频帧、动作解析、ASR 转写和 TTS 合成协议适配，以及限流错误
- `jiuwenswarm/extensions/video_duplex/backend/video_voice.py` — 各 provider 共用的 ASR/TTS 端点解析，以及 tts 合成、流式、取消和转写 RPC handler
- `jiuwenswarm/extensions/video_duplex/backend/video_search.py` — Core Agent 执行与异步搜索任务，生成结果简报（nonce 标记）和进度
- `jiuwenswarm/extensions/video_duplex/backend/settings.py` — 插件自有配置写回 env 文件，包括启用开关、provider 和回复语言
- **相关文档**
- `docs/zh/E2A-protocol.md` — 改到 tasks/bridge.py 的 checkpoint push/ACK 流程或 server_adapter.py 时读，确认 E2A 通道的字段和语义
- **按改动找页面**
- `jiuwenswarm/extensions/video_duplex/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/jiuwenswarm-extensions-video-duplex.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-09-30
