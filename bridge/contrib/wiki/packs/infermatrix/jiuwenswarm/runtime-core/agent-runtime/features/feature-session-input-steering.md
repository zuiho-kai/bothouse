---
name: feature-session-input-steering
description: 会话输入通道（steer/follow_up）与执行绑定知识页：stream() 的入口与错误契约、SessionInputRejectedError 族、投递路径与 runtime.accepted、input_mode/runtime_mode 参数约定、steer 仅文本的取舍、测试入口与覆盖
metadata:
  scope: 只收该功能的六块概览；逐条实现证据归 feature-depth-session-input-steering
---
# 会话输入通道（steer/follow_up）与执行绑定 — 知识页

## 现状

- **入口与错误契约**
- 会话输入通过 `Runtime.stream()` 进入：当请求被判定为 session input（`_is_session_input_request`）时，先调用 `validate_session_input(request.params)` 做参数校验，随后执行一组前置检查——禁止后台投递（抛 `ValueError`）、要求跨会话准入（`_require_cross_session_input_admission`）、要求带 `session_id` 的受支持单 Agent Session（否则 `ValueError`），
  - 且会话快照不属于本 Runtime 或处于 CLOSED/QUIESCING 时抛 `RuntimeStateError`。另有独立的 `SessionInputRejectedError` 异常族（含 `SESSION_INPUT_TARGET_CHANGED`、`SESSION_INPUT_QUEUE_REQUIRED` 两个子类），文档字符串将其描述为"入队前已知的拒绝"；所示片段中仅证明该族存在及 `_stream_session_input_started` 引用了它。
- Sources / 来源：[jiuwenswarm/runtime/service.py:L1747–L1761](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1747-L1761),
  - [jiuwenswarm/runtime/session_input.py:L15–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L15-L30),
  - [jiuwenswarm/runtime/service.py:L2155–L2162](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L2155-L2162)
- **投递路径与控制流**
- `stream()` 按会话工作类型分流：session input 走 `_session_coordinator.stream_session_input(...)`，并传入 `idle_input` 回调、`suspension_key=self._waiting_control_id` 以及 `expected_execution_id`（来自 `request.params`）；普通工作在 `work_kind` 非空时经 `run_stream(...)`，`work_kind` 为空时直接 `_stream_started(...)`。
  - `runtime.accepted`（`input_delivery: "chat"`）仅在 `idle_input` 回调的流式分支中、先于普通输出发出；非流式请求则在该回调中走 `_invoke_started` 保留单一最终响应。
- Sources / 来源：[jiuwenswarm/runtime/service.py:L1775–L1815](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1775-L1815),
  - [jiuwenswarm/runtime/service.py:L1816–L1839](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1816-L1839)
- **请求参数约定**
- 意图模式由 `resolve_session_input_mode` 从 params 的 `input_mode` / `runtime_mode`（旧别名）归一化读取：两者同为真值且归一化后不一致时抛 `ValueError`；未知值返回 `None`，保留普通发送行为而非报错。`validate_session_input` 要求：`expected_execution_id` 若出现必须是非空字符串且仅在 steer 模式下允许；`query` 必须是非空文本；
  - steer 模式下 `images/files/attachments/audio_files/video_files` 等真值字段直接拒绝。
- Sources / 来源：[jiuwenswarm/runtime/session_input.py:L33–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L33-L55),
  - [jiuwenswarm/runtime/session_input.py:L58–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L58-L73)
- **支持的行为**
- 支持两种输入意图：`SessionInputMode.STEER`（"steer"）与 `FOLLOW_UP`（"follow_up"）。steer 仅接受文本——注释解释为锁定 SDK 的主动转向队列只承载文本，附件应作为排队任务发送；带附件的 steer 请求在校验层被拒绝。执行绑定通过 `params["expected_execution_id"]` 表达，校验层限制其仅配 steer 模式使用，并在 `stream_session_input` 调用中作为 `expected_execution_id` 传入会话协调器（所示片段未展示协调器内部如何强制该绑定）。
- Sources / 来源：[jiuwenswarm/runtime/session_input.py:L10–L12](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L10-L12),
  - [jiuwenswarm/runtime/session_input.py:L58–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L58-L73),
  - [jiuwenswarm/runtime/service.py:L1808–L1815](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1808-L1815)
- **取舍**
- Inference / 设计推断（非作者历史意图）：
- 代码显式体现了两个约束性选择：其一，steer 请求携带附件时立即抛错，而不是接受一个会被 SDK 队列静默丢弃的附件（注释原文："Never acknowledge an attachment which that queue would silently discard"）——即以显式失败换取可观测性（此概括为 inference）。其二，`SessionInputTargetError` 的文档字符串规定补充输入"绝不能成为另一个执行的工作"，即执行绑定的正确性优先于宽松投递。
  - 此外流式客户端先收到 idle disposition（`runtime.accepted`）再收普通输出，而非流式客户端保留单一最终响应，这是对两种客户端形态的分别适配。
- Sources / 来源：[jiuwenswarm/runtime/session_input.py:L68–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L68-L73),
  - [jiuwenswarm/runtime/session_input.py:L21–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L21-L24),
  - [jiuwenswarm/runtime/service.py:L1779–L1806](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1779-L1806)
- **测试入口与覆盖**
- 运行时层的行为由 `tests/unit_tests/runtime/test_session_input.py` 驱动 `AgentRuntime.stream()`/`invoke()` 覆盖：繁忙会话中补充输入绕过占用通道并作为 `SESSION_INPUT` 子执行挂到根执行上（`test_new_input_bypasses_busy_lane_without_answer_or_second_agent`）；
  - `expected_execution_id` 绑定返回目标执行 ID 且不新建 CHAT_STREAM 执行，目标已结束或已切换时抛 "targeted execution has ended or changed" 且不产生副作用（`test_bound_input_keeps_original_execution_and_returns_its_id`、`test_bound_input_never_falls_back_or_targets_replacement`）；
  - 另有跨会话/受保护模式拒绝（`SessionInputQueueRequiredError`）、校验失败不派发（`ValueError`、模式冲突 "must agree"）、非本 Runtime 会话 `RuntimeStateError`、会话关闭取消在途输入等用例。
  - 适配器层由 `tests/unit_tests/agentserver/test_session_input_adapter.py` 直接调用 `JiuWenSwarmDeepAdapter.deliver_active_session_input`，配合真实 `LoopQueues` 验证 steer 文本经 `drain_steering()` 入队、竞态（执行结束/换轮/取消/跨会话/队列缺失）下 "not sent" 且队列为空，以及回执边界失败映射为 `SessionInputDeliveryUnknown`。测试上下文注明这些用例未在此环境中执行。
- Sources / 来源：[tests/unit_tests/runtime/test_session_input.py:L106–L132](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_session_input.py#L106-L132),
  - [tests/unit_tests/runtime/test_session_input.py:L259–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_session_input.py#L259-L274),
  - [tests/unit_tests/runtime/test_session_input.py:L279–L299](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_session_input.py#L279-L299),
  - [tests/unit_tests/agentserver/test_session_input_adapter.py:L167–L229](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_session_input_adapter.py#L167-L229)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/feature-session-input-steering.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1747-L1761；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_input.py:L15-L30
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L2155-L2162；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1775-L1815
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1816-L1839；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_input.py:L33-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_input.py:L58-L73；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_input.py:L10-L12
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1808-L1815；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_input.py:L68-L73
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_input.py:L21-L24；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1779-L1806
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_session_input.py:L106-L132；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_session_input.py:L259-L274
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_session_input.py:L279-L299；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_session_input_adapter.py:L167-L229
- 源页字段（feature）：session-input-steering
- 入口（entry_points）：jiuwenswarm/runtime/service.py
- 源页字段（source_globs）：jiuwenswarm/runtime/service.py；jiuwenswarm/runtime/session_input.py
