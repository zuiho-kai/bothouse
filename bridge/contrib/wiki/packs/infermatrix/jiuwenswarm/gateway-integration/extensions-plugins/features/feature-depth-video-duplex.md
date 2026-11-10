---
name: feature-depth-video-duplex
description: 音视频双工扩展实现深读：语音端点与原生通道判定、task_checkpoint 的匹配与中止规则、结算上报转后台任务、joyai 帧处理器的 BAD_REQUEST 单测、VoiceTaskServerAdapter 的两个方法
metadata:
  scope: 只收语音端点、task_checkpoint、结算上报与 VoiceTaskServerAdapter 的实现级证据；功能概览归 feature-video-duplex
---
# 音视频双工扩展：实现深读

## 现状

- [[feature-video-duplex]]（功能概览） · [[extensions-plugins-overview]]（owner 入口）
- **语音端点与原生通道判定** voice_config 的 ASR/TTS WebSocket 地址按 VOICE_ASR_ENDPOINT（或 VOICE_TTS_ENDPOINT）> JOYAI_ASR_WS_URL（或 JOYAI_TTS_WS_URL）> 默认 ws://127.0.0.1:8994/ws/asr 与 ws://127.0.0.1:8992/ws/tts 解析。
  - uses_native_voice_channel 仅在 video_live_mode == "joyai" 时可能为真：VOICE_PROTOCOL 非空则必须等于 "native_ws"，否则看 JOYAI_VOICE_PROVIDER（默认 "native"），值为 openai/openai_compatible/siliconflow 时返回 False。
- 来源：[jiuwenswarm/extensions/video_duplex/backend/joyai_provider.py:L65–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/joyai_provider.py#L65-L79),
  - [jiuwenswarm/extensions/video_duplex/backend/joyai_provider.py:L82–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/joyai_provider.py#L82-L89)
- **task_checkpoint 回调路径：按 managed_task_request 匹配绑定后在模型调用前检查** Root Agent 触发 before_model_call 后进入 task_checkpoint：从 ctx.extra 的 run_context.extra 取 managed_task_request，在 rail.managed_tasks 中按 request_id（无 id 时按 binding.root is ctx.agent）匹配绑定；
  - before_model 阶段依次执行 capture_execution()、check()、before_model()，作用于该次模型调用。
- 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L7–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py#L7-L23),
  - [jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L39–L59](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py#L39-L59)
- **task_checkpoint 依赖 rail.managed_tasks：request_id 匹配、假值时回退 root 身份** task_checkpoint 在 rail.managed_tasks 中按 binding.request_id == managed_task_request 匹配，request_id 为假值时回退按 binding.root is ctx.agent 匹配；
  - 该注册表由 bind_task_execution 经 adapter.task_execution_binding 填充，同 session_id 已占用时抛 RuntimeError("Task execution already bound")。
- 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L42–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py#L42-L47),
  - [jiuwenswarm/extensions/video_duplex/backend/tasks/execution.py:L58–L70](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/execution.py#L58-L70)
- **task_checkpoint：无匹配绑定且 managed_task_request 为真值才中止；root 匹配分支包装异常** rail.managed_tasks 无匹配绑定时，仅当 managed_task_request 为真值才抛 AbortError("TASK_EXECUTION_BINDING_CLOSED")，为假值则直接 return；在 ctx.agent is checkpoint.root 的分支内，stage 调用抛出的异常被包装为 AbortError("TASK_CHECKPOINT_REJECTED", cause=exc) 后重抛。
- 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L42–L53](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py#L42-L53),
  - [jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L54–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py#L54-L65)
- **结算上报可转后台任务：不阻塞收尾，但失败仅记 warning（推断）** 设计推断（非作者历史意图）：
- bind_task_execution 收尾时若 native_executions 未全部 done，report_settlement 改由 asyncio.create_task 后台执行；推断收益：请求方 finally 不必等待远端 close/settle；推断代价：该后台任务异常只触发 logger.warning('Task settlement acknowledgement failed: …')，不传播给原调用。
- 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/execution.py:L98–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/execution.py#L98-L126)
- **test_joyai_frame_handler_rejects_non_image_payload 运行时断言非图片载荷返回 BAD_REQUEST** 该 pytest.mark.asyncio 测试以 {'frame_data_url': 'not-an-image'} 直接调用 channel.handlers['video.joyai.frame']，并把 joyai_provider.request_frame 替换为被调即抛 AssertionError 的 fail_request；
  - 断言最后一个响应 code=='BAD_REQUEST'，即非图片载荷在触达 JoyAI 前被拒。
- 来源：[jiuwenswarm/extensions/video_duplex/tests/backend/test_video_live.py:L1632–L1647](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/tests/backend/test_video_live.py#L1632-L1647)
- **VoiceTaskServerAdapter.methods 声明两方法；handle 分支的真值校验与返回契约** methods 仅声明 VOICE_TASK_CHECKPOINT_ACK 与 VOICE_TASK_FILES；handle 按 req_method 分支：ACK 分支返回 accepted，另一分支要求 session 匹配 managed-task-[0-9a-f]{32} 且 execution_request_id 为真值，否则抛 ValueError("Invalid task execution identity")。
  - 其后 guard、user_id 校验与 flush_pending_writes(timeout=5) 仍可抛错中止返回；全部通过后仅收集该 execution_id 的 chat.file 记录为 files，并以 AgentResponse ok=True 延续原请求与渠道标识。
- 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/server_adapter.py:L13–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/server_adapter.py#L13-L52)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-depth-video-duplex.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/joyai_provider.py:L65-L79；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/joyai_provider.py:L82-L89
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L7-L23；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L39-L59
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/execution.py:L98-L126
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/tests/backend/test_video_live.py:L1632-L1647；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L42-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/execution.py:L58-L70；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L42-L53
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py:L54-L65；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/server_adapter.py:L13-L52
- 源页字段（feature）：video-duplex
- 入口（entry_points）：jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py
- 源页字段（source_globs）：jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py；jiuwenswarm/extensions/video_duplex/*
