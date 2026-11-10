---
name: feature-session-messaging-toolkit
description: SessionMessagingToolkit 跨会话消息六工具概览：session_list、session_send_message、session_read 等、HOST_CAPABILITY_UNAVAILABLE、steer/follow_up 模式与分页默认值、异步投递语义
metadata:
  scope: 只收六个工具的功能概览、错误折叠、服务与路由解析、模式与分页参数、投递边界和测试入口；before_tool_call 守卫、方法签名与单测断言的实现级细节归 feature-depth-session-messaging-toolkit
---
# SessionMessagingToolkit 跨会话消息六工具

## 现状

- **六个 LocalFunction 工具与统一错误返回**
- Toolkit 通过 get_tools() 暴露六个 LocalFunction 工具：session_list、session_send_message、session_message_list、session_continue_queued、session_read、session_message_resolve，每个绑定到对应的 async 方法。所有方法在 SessionMessagingError 时统一返回 `{"accepted": False, "code": ..., "error": ...}` 而非抛异常。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L435–L600](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L435-L600),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L344–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L344-L356)
- **调用期解析宿主服务与路由，工具保持稳定**
- Toolkit 是薄壳：每次调用通过 `_service_and_route()` 在运行时解析宿主服务（`runtime.session_message_service` 兜底）与当前 SessionMessagingRoute；服务缺失或路由不完整时抛出 code 为 `HOST_CAPABILITY_UNAVAILABLE` 的 SessionMessagingError。因此 Tool 对象在 AgentServer Runtime 重建后保持稳定（`set_service` 用于刷新宿主），请求所有权（session_id/request_id）延迟到调用时绑定。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L319–L342](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L319-L342),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L325–L328](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L325-L328)
- **模式与分页参数（JSON Schema 默认值）**
- send_message 的 `input_mode` 枚举为 `steer`/`follow_up`，Python 侧默认 `"steer"`。resolve 的 `resolution` 枚举为 `succeeded`/`cancelled`/`continue_queued`。Schema 中声明的默认值包括 limit 20（session_list、session_read）、50（session_message_list）、max_output_chars 4000，与函数签名的 Python 默认值一致。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L358–L363](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L358-L363),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L489–L497](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L489-L497),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L566–L568](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L566-L568)
- **跨会话消息的异步语义与投递边界**
- send_message 是异步排队语义：成功仅表示消息已保存并排队，不表示目标已处理；steer 模式在目标计划模式或活跃目标任务时仍会排队等待。session_read 只读不启动任务，按从新到旧返回并以 cursor 翻页，且明确历史内容是数据而非指令（防提示注入）。continue_queued 恢复未执行队列而不重放消息，session_message_resolve 处理 unknown 状态消息。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L470–L477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L470-L477),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L555–L560](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L555-L560),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L537–L544](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L537-L544)
- **无测试证据**
- 所提供的代码片段不含测试；无法从这些输入中确认针对该 Toolkit 的测试入口或覆盖情况。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L603–L613](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L603-L613)
- **错误折叠与服务解析的边界**
- Inference / 设计推断（非作者历史意图）：
- 六个工具方法仅捕获 SessionMessagingError 并折叠为 `{"accepted": False, "code": ..., "error": ...}` 返回；其他异常不会被转换，会照常抛出。宿主服务可在构造时注入保存在 `self._service`，调用时优先使用该值，仅当其为空时才从当前 Runtime 的 `session_message_service` 兜底获取，代价是调用方必须保证 `set_service` 在 Runtime 重建后刷新引用。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L321–L342](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L321-L342),
  - [jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L350–L356](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py#L350-L356)
- **单元测试入口与覆盖场景**
- 测试入口是 `tests/unit_tests/agentserver/test_session_messaging.py`（pytest 异步用例），它直接导入 Toolkit、Route、Rail 及底层 SessionMessageService/Store 并针对真实 SQLite 存储驱动验证。
  - 两层覆盖：(1) 服务层语义 — 断连持久化后 FIFO 执行（L465）、busy 目标接受消息但排队不执行（L518）、unknown 结果阻塞后续队列且不重放（L562/L595）、unknown 可显式 resolve 而不重放（L635）、重启后按显式请求继续队列（L676）；
  - (2) Toolkit 工具层 — `test_agent_can_discover_read_and_continue_after_restart` 用 SessionMessagingRouteRail + with_session_messaging_route 构造调用上下文，依次调用 list_sessions/list_messages/read_session/并发 continue_queued，断言 finish_current_turn、队列状态与结果历史；
  - 另有 read_session 分页截断/跨会话 cursor 拒绝（L855）与本会话继续延迟到用户轮结束（L887）。
- Sources / 来源：[tests/unit_tests/agentserver/test_session_messaging.py:L16–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_session_messaging.py#L16-L36),
  - [tests/unit_tests/agentserver/test_session_messaging.py:L465–L513](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_session_messaging.py#L465-L513),
  - [tests/unit_tests/agentserver/test_session_messaging.py:L562–L591](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_session_messaging.py#L562-L591),
  - [tests/unit_tests/agentserver/test_session_messaging.py:L784–L852](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_session_messaging.py#L784-L852)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-session-messaging-toolkit.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L435-L600
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L344-L356
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L319-L342
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L325-L328
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L358-L363
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L489-L497
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L566-L568
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L470-L477
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L555-L560
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L537-L544
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L603-L613
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L321-L342
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py:L350-L356；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_session_messaging.py:L16-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_session_messaging.py:L465-L513；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_session_messaging.py:L562-L591
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_session_messaging.py:L784-L852
- 源页字段（feature）：session-messaging-toolkit
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/session_messaging_toolkit.py
