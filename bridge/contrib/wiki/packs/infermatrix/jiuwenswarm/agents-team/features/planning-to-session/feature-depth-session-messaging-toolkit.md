---
name: feature-depth-session-messaging-toolkit
description: SessionMessagingToolkit 实现深读：before_tool_call 路由绑定、六个工具方法签名、本地默认值（input_mode steer、limit 20/50、max_output_chars 4000）、MISSING_TOOL_CALL_ID 与 read_session 分页单测
metadata:
  scope: 只收 SessionMessagingToolkit 的实现级事实；六工具与投递语义的概览归 feature-session-messaging-toolkit
---
# 跨会话消息 Agent 工具集（SessionMessagingToolkit 六工具）：实现深读

## 现状

- [[feature-session-messaging-toolkit]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **before_tool_call 回调按守卫绑定路由后再由 send_message 构造来源并调用服务** before_tool_call 仅当工具名属于 _SESSION_MESSAGING_TOOL_NAMES 且路由含 session_id 与 request_id 时，把路由和 tool_call_id 写入上下文变量；send_message 随后用该 tool_call_id 调 source_for_call 并调用 service.send_message。
- 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L287–L302](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L287-L302),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L358–L378](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L358-L378),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L43–L67](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L43-L67)
- **六个工具方法签名各异，均要求服务与就绪路由，SessionMessagingError 转为结构化字典返回** list_sessions/list_messages/continue_queued/read_session/resolve_message/send_message 均先经 _service_and_route，成功时透传 service 的 dict；send_message 额外要求上下文中已有 tool_call_id，失败时返回 {"accepted": False, "code": ..., "error": ...}。
  - get_tools 首次构建后缓存并返回列表副本。
- 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L330–L433](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L330-L433),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L435–L445](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L435-L445),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L594–L600](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L594-L600)
- **工具入参默认值仅为本地签名默认：input_mode="steer"、limit 20/50、offset 0、cursor None、max_output_chars 4000** send_message 的 input_mode 默认 "steer"；list_sessions 默认 query=""、limit=20、offset=0；list_messages 默认 limit=50；read_session 默认 cursor=None、limit=20、max_output_chars=4000。这些是调用方未传参时的本地默认，非硬性上限。
- 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L344–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L344-L356),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L358–L385](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L358-L385),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L404–L418](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L404-L418)
- **工具依赖运行时上下文中的 session_message_service 与路由上下文变量** _service_and_route 优先用 set_service 注入的服务，否则从 get_current_runtime() 的 session_message_service 属性取；路由来自 _SESSION_MESSAGING_ROUTE 上下文变量（由 before_tool_call 在工具名匹配 _SESSION_MESSAGING_TOOL_NAMES 且路由含 session_id/request_id 时设置）。
  - 缺任一则抛 HOST_CAPABILITY_UNAVAILABLE。
- 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L325–L342](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L325-L342),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L287–L302](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L287-L302)
- **服务缺失或路由不完整触发 HOST_CAPABILITY_UNAVAILABLE，空 tool_call_id 触发 MISSING_TOOL_CALL_ID** _service_and_route 在 service 为 None 或路由缺 session_id/request_id 时抛 code 为 HOST_CAPABILITY_UNAVAILABLE 的 SessionMessagingError；source_for_call 在 tool_call_id 为空串时抛 MISSING_TOOL_CALL_ID。
  - 所示方法内这些异常被捕获并转为 accepted=False 的字典返回。
- 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L330–L342](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L330-L342),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L43–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L43-L54),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L350–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L350-L356)
- **每工具局部捕获 SessionMessagingError 换取 Agent 可读的错误码，代价是该异常不再向上传播** 设计推断（非作者历史意图）：
- benefit：Agent 调用方直接拿到含 code 的结构化结果而非异常；cost：该异常在每个工具方法内被就地吞掉，且 except 仅覆盖 SessionMessagingError，其他异常类型不在该局部兜底内。此为基于所示实现的推断。
- 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L350–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L350-L356),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L358–L378](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L358-L378)
- **单元测试断言 read_session 分页、截断且不触发执行** test（866-882 行）用临时 sqlite store 调 service.read_session(limit=2, max_output_chars=8)，断言 newest_first 的 id 顺序 ["4","3"]、内容截断为 8 字符且无 private_metadata、游标翻页到 ["2","1"]、跨会话游标抛 SessionMessagingError、service._execute 未被 await。这是已存在的自动化运行时测试，本文未执行它。
- 来源：[tests/unit_tests/agentserver/test_session_messaging.py:L866–L882](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_session_messaging.py#L866-L882)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-session-messaging-toolkit.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L325-L342
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L287-L302；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_session_messaging.py:L866-L882
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L358-L378
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L43-L67
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L330-L433
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L435-L445
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L594-L600
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L344-L356
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L358-L385
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L404-L418
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L330-L342
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L43-L54
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L350-L356
- 源页字段（feature）：session-messaging-toolkit
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py
