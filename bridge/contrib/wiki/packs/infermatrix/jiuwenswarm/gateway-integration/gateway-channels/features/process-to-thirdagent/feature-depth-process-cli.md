---
name: feature-depth-process-cli
description: 机器执行与本地 CLI 实现深读：run.execute→_build_request→resolve_cli_work_mode 请求链、InProcessRuntimeClient 直连 AgentRuntime、控制命令单测、OneShotRunResult 构造校验、--timeout 缺省与 query_runtime 30.0、超时返回 124、details 构造失败丢弃诊断（中英文混排）
metadata:
  scope: 只收进程式 CLI 的逐函数实现细节与行为断言；职责、配置边界与验证建议归 feature-process-cli
---
# 机器执行与本地 CLI：实现深读

## 现状

- [[feature-process-cli]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **Chat request construction chain: run.execute → _build_request → resolve_cli_work_mode** In the chat operation, run.execute first calls create_or_resume_session to obtain a session ID, then passes it into _build_request.
  - _build_request calls resolve_cli_work_mode with args.mode and args.work_mode to determine the work mode (a mode with a two-segment profile like agent.code uses the embedded profile and takes precedence),
  - and finally assembles an AgentRequest with channel_id="process_cli" and is_stream=True for streaming submission.
- 调用路径：`jiuwenswarm/channels/process_cli/app.py`（`run.execute`） → `jiuwenswarm/channels/process_cli/app.py`（`_build_request`） → `jiuwenswarm/channels/process_cli/display_context.py`（`resolve_cli_work_mode`）
- 来源：[jiuwenswarm/channels/process_cli/app.py:L732–L921](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L732-L921),
  - [jiuwenswarm/channels/process_cli/app.py:L80–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L80-L116),
  - [jiuwenswarm/channels/process_cli/display_context.py:L228–L252](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/display_context.py#L228-L252),
  - [jiuwenswarm/common/schema/agent.py:L68–L94](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/schema/agent.py#L68-L94)
- **In-process coupling with AgentRuntime** InProcessRuntimeClient directly holds an AgentRuntime instance in __init__ (or injects one), with start/stream/invocation/session methods forwarding directly to it, without any socket or line protocol.
  - This determines that the process CLI process itself is responsible for starting and cleaning up the Runtime (client.close in run's finally block).
- 来源：[jiuwenswarm/channels/process_cli/client.py:L73–L252](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/client.py#L73-L252),
  - [jiuwenswarm/channels/process_cli/app.py:L732–L921](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L732-L921)
- **Unit test entry points for interactive control commands** tests/unit_tests/process_cli/test_control_commands.py::test_sessions_status_and_permissions_query_current_runtime_state replaces query_runtime and asserts that /sessions, /status, /permissions trigger session.list, session.get,
  - permission.get in order with correct parameters, and that the output contains the current session marker and model line. Another test test_sessions_search_and_selection_restore_owned_session exercises search pagination parameter iteration and the session_id update after selection.
- 来源：[tests/unit_tests/process_cli/test_control_commands.py:L1–L180](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/process_cli/test_control_commands.py#L1-L180)
- **OneShotRunResult 构造期校验 error 类型与 status/exit_code 组合** 构造时若 error 非空且不是 RuntimeErrorInfo，抛 TypeError("error must be RuntimeErrorInfo")；status 等于 RunStatus.COMPLETED.value 时要求 session_id 存在、exit_code 为 0 且 error 为 None，任一违反抛 ValueError。
- 来源：[jiuwenswarm/channels/process_cli/protocol/model.py:L669–L682](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/protocol/model.py#L669-L682)
- **--timeout 缺省时不包装 execute()；query_runtime 的 timeout 默认 30.0** app.py 仅在 `args.timeout is not None` 时用 asyncio.timeout(args.timeout) 包住 execute()（文档选项表 `--timeout <seconds>` 默认为 —，未设置即无此截止包装）；query_runtime 的 timeout 形参默认 30.0，作为请求中的 timeout_seconds 发送，外层 wait_for 另用 timeout + 5 兜底。
- 来源：[jiuwenswarm/channels/process_cli/app.py:L855–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L855-L860),
  - [docs/zh/命令行指令.md:L241–L242](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L241-L242),
  - [jiuwenswarm/channels/process_cli/control_commands.py:L22–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/control_commands.py#L22-L28),
  - [jiuwenswarm/channels/process_cli/control_commands.py:L53–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/control_commands.py#L53-L57)
- **run.execute 超时返回 124、CancelledError 重抛；
  - 仅 CHAT 且 request 非空时执行有界 cancel** TimeoutError 分支在 request 不为 None 且 operation == CHAT_OPERATION 时 `await _bounded_cleanup(client.cancel(_cancel_request(request)))`——wait_for 限时 SHUTDOWN_STEP_TIMEOUT_SECONDS 并吞掉 Exception——然后渲染 TimeoutError 错误事件并 return 124；
  - CancelledError 分支同样有界取消、renderer.interrupted() 后 raise。
- 来源：[jiuwenswarm/channels/process_cli/app.py:L867–L888](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L867-L888),
  - [jiuwenswarm/channels/process_cli/app.py:L924–L929](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L924-L929)
- **details 构造失败时丢弃诊断以保留原始失败（TypeError/ValueError 分支）** 设计推断（非作者历史意图）：
- 当构造 details 引发 TypeError/ValueError 时，该分支改返回不含 details 的 RuntimeErrorInfo：收益（代码注释：可选诊断不得掩盖执行失败、不得序列化任意 Runtime 对象），代价是这些诊断信息被静默丢弃。
- 来源：[jiuwenswarm/channels/process_cli/machine_result.py:L90–L96](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine_result.py#L90-L96)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-process-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/app.py:L732-L921；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/app.py:L80-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/display_context.py:L228-L252；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/schema/agent.py:L68-L94
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/client.py:L73-L252；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/process_cli/test_control_commands.py:L1-L180
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/app.py:L855-L860；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/命令行指令.md:L241-L242
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/control_commands.py:L22-L28；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/control_commands.py:L53-L57
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/app.py:L867-L888；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/app.py:L924-L929
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/protocol/model.py:L669-L682；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/machine_result.py:L90-L96
- 源页字段（feature）：process-cli
- 入口（entry_points）：jiuwenswarm/channels/process_cli/app.py
- 源页字段（source_globs）：jiuwenswarm/channels/process_cli/app.py；jiuwenswarm/channels/process_cli/*.py
