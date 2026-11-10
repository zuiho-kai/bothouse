---
name: feature-depth-session-input-steering
description: 会话输入通道（steer/follow_up）与执行绑定实现深读（英文条目）：invoke 经 stream 委托到 _deliver_control、validate_session_input 的调用方义务、input_mode 优先于 runtime_mode、补充输入需要活动 Agent、steer 仅文本的取舍、绑定输入单测断言
metadata:
  scope: 收 session_input.py 与 service.py 的实现级证据，来源另含 test_session_input.py；功能概览归 feature-session-input-steering
---
# Session Input Lane (steer/follow_up) and Execution Binding：实现深读

## 现状

- [[feature-session-input-steering]]（功能概览） · [[agent-runtime-overview]]（owner 入口）
- **AgentRuntime.invoke delegates session-input requests to stream, which validates then routes CONTROL_INPUT to _deliver_control** In invoke, when _is_session_input_request(request) is true the branch consumes self.stream(...) and returns only events whose payload is not None.
  - In stream, after validate_session_input, a foreground-only guard, cross-session admission and session snapshot/state checks, session_work_kind returning CONTROL_INPUT routes the request to _deliver_control with the caller's on_control_event.
- 来源：[jiuwenswarm/runtime/service.py:L1319–L1325](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1319-L1325),
  - [jiuwenswarm/runtime/service.py:L1747–L1769](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1747-L1769)
- **validate_session_input caller obligations: non-empty query, steer-only binding, text-only steer** validate_session_input(params) raises ValueError unless params['query'] is non-blank text;
  - if 'expected_execution_id' is present it must be a non-empty string and resolve_session_input_mode(params) must be STEER; in STEER mode any non-empty images/image_files/files/attachments/audio_files/video_files raise ValueError("steering supports text only; send attachments as a queued task").
- 来源：[jiuwenswarm/runtime/session_input.py:L58–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L58-L73)
- **input_mode wins over the runtime_mode alias; both truthy and differing raises; unknown values fall back to None** resolve_session_input_mode reads params['input_mode'] (primary) and params['runtime_mode'] (alias);
  - if both are truthy and their normalized forms differ it raises ValueError('input_mode and runtime_mode must agree'), otherwise the primary (or alias when primary is falsy) is normalized and mapped to SessionInputMode, with unknown values returning None.
  - The docstring notes interaction answers are classified separately before this intent.
- 来源：[jiuwenswarm/runtime/session_input.py:L33–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L33-L55)
- **Supplement delivery requires an active agent exposing deliver_session_input** Input delivery looks up the agent via agent_manager.get_agent_for_session_nowait(owner_channel, session_id); if no agent is found it raises SessionInputRejectedError("session has no active agent: ..."),
  - and if the agent lacks a callable deliver_session_input it raises SessionInputRejectedError("active agent does not support supplemental input") before streaming.
- 来源：[jiuwenswarm/runtime/service.py:L2159–L2176](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L2159-L2176)
- **validate_session_input raises ValueError for blank query, non-steer expected_execution_id, and steer attachments** If params contains expected_execution_id it must be a non-empty string and the resolved mode must be STEER, else ValueError;
  - a query that is not a non-empty-trimmed string raises 'session input requires non-empty text'; in STEER mode any truthy value among images/image_files/files/attachments/audio_files/video_files raises 'steering supports text only; send attachments as a queued task'.
  - Separately, stream raises ValueError for background session input and RuntimeStateError when the session snapshot is missing or in CLOSED/QUIESCING.
- 来源：[jiuwenswarm/runtime/session_input.py:L58–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L58-L73),
  - [jiuwenswarm/runtime/service.py:L1748–L1761](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1748-L1761)
- **Steering accepts text only: avoids silent attachment loss at the cost of a separate queued task** 设计推断（非作者历史意图）：
- The comment at session_input.py:68-73 states the SDK's active steering queue carries text only, so non-empty attachment keys are rejected rather than acknowledged-and-dropped; the cost (design inference) is that callers with attachments must send them as an ordinary queued task instead of a steer.
- 来源：[jiuwenswarm/runtime/session_input.py:L65–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L65-L73)
- **Automated runtime test asserts bound input keeps the original execution and returns its id** test_bound_input_keeps_original_execution_and_returns_its_id (parametrized unary/stream) starts an original stream, snapshots the coordinator to get target execution_id,
  - sends request(expected_execution_id=target), asserts events == [runtime.accepted] with payload['execution_id'] == target, exactly one CHAT_STREAM execution remains, original is not done and agent not cancelled, and the original's final event carries the same execution_id.
- 来源：[tests/unit_tests/runtime/test_session_input.py:L257–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_session_input.py#L257-L274)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/feature-depth-session-input-steering.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_input.py:L58-L73；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L2159-L2176
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_input.py:L65-L73；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_session_input.py:L257-L274
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1319-L1325；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1747-L1769
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_input.py:L33-L55；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1748-L1761
- 源页字段（feature）：session-input-steering
- 入口（entry_points）：jiuwenswarm/runtime/service.py
- 源页字段（source_globs）：jiuwenswarm/runtime/service.py；jiuwenswarm/runtime/session_input.py
