---
name: extensions-plugins-knowledge
description: video_duplex 验证入口与配置知识：VIDEO_LIVE_MODE / VIDEO_DUPLEX_ENABLED 开关、register_video_live_handler 装配、RPC 注册契约与文档分歧、JoyAI delegation 两条路径，附 video_live.py 源码依据
metadata:
  scope: 只收 video_duplex 的配置、装配、RPC 契约和 delegation 知识片段；该扩展的审查规则归 extensions-plugins-rules，文件导览归 jiuwenswarm-extensions-video-duplex
---
# jiuwenswarm 扩展与插件：video_duplex 实时音视频 RPC 与 AgentOS Router 客户端

## 现状

- **验证入口**
- 上游文档说明内置 `jiuwenswarm/extensions/video_duplex` 是应用插件的完整参考示例，其配置与测试保留在插件目录内；插件发现与静态资源可用通用 HTTP 接口 `GET /api/application-plugins` 与 `GET /api/application-plugins/{plugin_id}/assets/{asset_path}` 检查。注册成功本身也会写一条 `video_handlers_registered` 事件日志，可作为装配发生的运行时信号。本页展示的输入未包含这些测试文件本身，故不描述其覆盖范围。
- Sources / 来源：[docs/zh/application-plugins.md:L57–L62](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L57-L62),
  - [docs/zh/application-plugins.md:L145–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L145-L149),
  - [jiuwenswarm/extensions/video_duplex/backend/video_live.py:L692–L698](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L692-L698)
- **环境变量开关与双 Provider 配置**
- 运行模式由 `VIDEO_LIVE_MODE` 决定：缺省 `joyai`，仅当值（大小写不敏感）为 `realtime` 时切换到 Qwen Omni 实时模式。`VIDEO_DUPLEX_ENABLED` 缺省视为启用，取值 `0/false/no/off` 时禁用。
  - JoyAI 模式下 `_realtime_config` 读取 `joyai_provider.model_config()`，任一为空即以 `VIDEO_CONFIG_ERROR` 返回错误信息“请配置 JOYAI_API_BASE 和 JOYAI_MODEL_NAME”（具体读取逻辑在未提供的 joyai_provider 中）；
  - realtime 模式则由 `QwenOmniRealtimeConfig.from_environment()` 构造并 `validate()`，仅 `validate()` 抛出的 ValueError 被转为 `VIDEO_CONFIG_ERROR`，`from_environment()` 本身在 try 块之外。
- Sources / 来源：[jiuwenswarm/extensions/video_duplex/backend/video_live.py:L170–L187](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L170-L187),
  - [jiuwenswarm/extensions/video_duplex/backend/video_live.py:L210–L250](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L210-L250)
- **装配与日志职责**
- register_video_live_handler(channel) 是 video_duplex 后端的装配入口：构造 VideoSearchManager（注入延迟解析的 log_event/qwen_active 回调，使运行时或测试覆盖仍然生效）和 voice handlers，把全部处理器注册到 channel 后返回 search_manager。诊断日志由 _append_jsonl 统一实现：在 threading.Lock 下把单个 JSON 对象写成一行，覆盖 search 完成与 router 响应可能落在不同 worker 线程的并发追加；
  - 遥测、会话、ASR、JoyAI 等各写入 ~/.jiuwenswarm/logs 下不同的 jsonl 文件。注意并非所有客户端事件都进这些文件：不符合命名规则的遥测事件会被拒绝，会话事件走 append_history_record 持久化。
- Sources / 来源：[jiuwenswarm/extensions/video_duplex/backend/video_live.py:L189–L208](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L189-L208),
  - [jiuwenswarm/extensions/video_duplex/backend/video_live.py:L71–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L71-L89),
  - [jiuwenswarm/extensions/video_duplex/backend/video_live.py:L481–L488](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L481-L488),
  - [jiuwenswarm/extensions/video_duplex/backend/video_live.py:L646–L656](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L646-L656)
- **RPC 注册契约与文档分歧**
- handlers 字典显式列出 video.realtime.config、video.joyai.frame、video.realtime.telemetry、video.conversation.append 以及五个 video.qwen.tool / video.search.* 方法，并合入 video_voice.create_voice_handlers 返回的额外处理器；每个方法都以 local_only=True、available_when_disabled=True 注册。
  - 这与上游文档存在分歧：docs/zh/application-plugins.md 规定 available_when_disabled 只应用于配置和启用状态等管理接口，不应赋给业务运行时接口，而此处的业务 RPC（如 video.joyai.frame）也带该标志——分歧按源码记录，不视为文档要求的豁免。参数校验示例：_joyai_frame 对非法图片 data URL 或超限 frame_data_url 返回 BAD_REQUEST 错误。
- Sources / 来源：[jiuwenswarm/extensions/video_duplex/backend/video_live.py:L673–L691](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L673-L691),
  - [docs/zh/application-plugins.md:L111–L133](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L111-L133),
  - [jiuwenswarm/extensions/video_duplex/backend/video_live.py:L265–L275](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L265-L275)
- **JoyAI delegation 的两条路径**
- JoyAI 结果的 decision 取值限定为 silence/response/delegation（_validate_joyai_result，非法结构抛 ValueError）。
  - delegation 有两条路径：只有以 "{" 开头且能解析为仅含 name/arguments 的 JSON、name 属于 jiuwen_delegate/jiuwen_task_query/jiuwen_task_modify/jiuwen_task_cancel 之一时，才进入任务操作循环（最多 3 次，query/modify/cancel 的回执经 task_receipt_followup 送回同一 provider 会话）；
  - 不以 "{" 开头的 delegation 直接跳出该循环，但其后只要 decision 仍为 delegation 且字符串非空，任何纯文本 delegation 也会作为 query 传给 search_manager.start 启动搜索任务。因此"delegation 只接受显式 JSON"不成立——JSON 校验只约束任务操作工具，不约束任务启动本身。
- Sources / 来源：[jiuwenswarm/extensions/video_duplex/backend/video_live.py:L152–L159](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L152-L159),
  - [jiuwenswarm/extensions/video_duplex/backend/video_live.py:L374–L411](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L374-L411),
  - [jiuwenswarm/extensions/video_duplex/backend/video_live.py:L434–L448](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/video_live.py#L434-L448)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/application-plugins.md:L57-L62；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/application-plugins.md:L145-L149
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L692-L698；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L170-L187
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L210-L250；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L189-L208
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L71-L89；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L481-L488
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L646-L656；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L673-L691
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/application-plugins.md:L111-L133；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L265-L275
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L152-L159；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L374-L411
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/video_live.py:L434-L448
