---
name: feature-depth-harness
description: Agent Loop 与 Rail 装配实现深读：浏览器运行时环境变量开关与 BROWSER_DRIVER 默认 managed、相关单测入口、before_model_call 恢复门与 abort 检查及闩锁超时 fail-open、AutoHarnessService.run 的 chat.error、capture_permission_layers 三层权限合成
metadata:
  scope: 收 interface_deep.py 与 harness 服务的实现级证据，来源另含 Harness.md、permissions_layers.py、service.py、stream_event_rail.py、test_agentserver_modes.py、test_app_agentserver.py；功能概览与环境变量名归 feature-harness
---
# Agent Loop 与 Rail 装配：实现深读

## 现状

- [[feature-harness]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **浏览器运行时开关与 BROWSER_DRIVER 默认值** _browser_runtime_enabled 依次读取环境变量 PLAYWRIGHT_RUNTIME_MCP_ENABLED、BROWSER_RUNTIME_MCP_ENABLED（先者优先），去空白并小写后属于 {"1","true","yes","on"} 才启用；浏览器子代理启用而 BROWSER_DRIVER 为空时，_build_configured_subagents 会写入默认值 "managed"。
  - 另有 _resolve_enable_subagent_runtime：_subagent_runtime_supported 缺省为 True，最终由 is_subagent_runtime_enabled(config_base 或 get_config()) 决定。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L4363–L4374](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L4363-L4374),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L4756–L4777](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L4756-L4777),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L9561–L9568](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L9561-L9568)
- **相关单测入口** tests/unit_tests/agentserver/test_agentserver_modes.py 中 test_external_memory_finalize_retries_after_commit_failure 用 object.__new__(JiuWenSwarmDeepAdapter) 直接驱动 _finalize_external_memory_session，断言 provider 首次抛错后可重试、成功后才置 _external_memory_session_finalized=True；
  - test_app_agentserver.py 的 test_run_does_not_delete_agent_teams_directory 断言 app_agentserver._run 的启动顺序且不删除目录。所提供切片中没有直接覆盖 rail 装配链的测试。
- 来源：[tests/unit_tests/agentserver/test_agentserver_modes.py:L141–L170](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_agentserver_modes.py#L141-L170),
  - [tests/unit_tests/test_app_agentserver.py:L57–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_app_agentserver.py#L57-L104)
- **before_model_call 钩子：恢复门与 abort 检查后注入/清洗模型上下文** before_model_call 属内层 ReAct 模型级钩子（文档）；回调解析 sid 后在该检查点等恢复闩锁（事件创建即置位，未暂停立即返回），_abort_requested.get(sid) 为真则抛 asyncio.CancelledError("Agent abort requested")，否则注入 call_goal ToolInfo schema；
  - ctx.context 非 None 时若 _read_image_multimodal_enabled() 为假则剥离图片内容并修复不完整工具上下文。
- 来源：[jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L983–L998](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/stream_event_rail.py#L983-L998),
  - [jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L589–L611](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/stream_event_rail.py#L589-L611),
  - [docs/zh/Harness.md:L73–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L73-L84)
- **AutoHarnessService.run：query/model/auto_accept 仅关键字可选，活动 run 冲突时产出 is_complete=False 的 chat.error chunk** async 生成器 run(request, session_id, request_id, *, query="", model=None, auto_accept=False) 返回 AsyncIterator[AgentResponseChunk]，docstring 声明 chunk 由 orchestrator 输出映射；
  - 当 session_id 已在 _active_runs 时产出 event_type="chat.error"、is_complete=False 的错误 chunk。
- 来源：[jiuwenswarm/agents/harness/common/auto_harness/service.py:L1683–L1722](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/service.py#L1683-L1722)
- **capture_permission_layers：permission_storage_lock 内读三层，经 compose_host_effective_permissions 合成 effective** 函数内导入 permission_compose.compose_host_effective_permissions，在 permission_storage_lock(session_id) 内经 read_permission_layers_locked 一次读取 Global/User/Session 后现场合成；
  - 结果是调用方一次拿到同锁一致的 (global, user, session, effective) 四元组。
- 来源：[jiuwenswarm/agents/harness/common/rails/permissions/permissions_layers.py:L216–L227](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permissions_layers.py#L216-L227)
- **before_model_call 局部行为：闩锁等待仅捕获 TimeoutError 后 fail-open；abort 置位时抛 CancelledError** before_model_call 先 await _wait_for_resume(sid, "before_model_call")；若 self._abort_requested.get(sid, False) 则抛 asyncio.CancelledError("Agent abort requested")。
  - _wait_for_resume 仅捕获 asyncio.TimeoutError，超时记 error 日志后 event.set() 放行，其余异常不在此转换。
- 来源：[jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L589–L622](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/stream_event_rail.py#L589-L622),
  - [jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L983–L994](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/stream_event_rail.py#L983-L994)
- **暂停闩锁超时自愈换继续执行：后续检查点免重复等待（若闩锁未被再次清除），代价是未经 resume 也放行** 设计推断（非作者历史意图）：
- before_model_call 调用 _wait_for_resume：闩锁已 set 时立即返回，否则以 self._PAUSE_WAIT_TIMEOUT_SECONDS 走 asyncio.wait_for，TimeoutError 分支自行 event.set()。推断：收益是超时后该 sid 的后续检查点可立即返回，前提是同一事件仍映射该 sid 且未被 pause() 再次清除；代价是超时后没有显式 resume() 也继续执行（fail-open）。
- 来源：[jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L598–L622](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/stream_event_rail.py#L598-L622),
  - [jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L983–L985](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/stream_event_rail.py#L983-L985)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-harness.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L4363-L4374；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L4756-L4777
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L9561-L9568；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_agentserver_modes.py:L141-L170
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_app_agentserver.py:L57-L104；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_harness/service.py:L1683-L1722
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/permissions_layers.py:L216-L227
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L983-L998；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L589-L611
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Harness.md:L73-L84；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L589-L622
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L983-L994；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L598-L622
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/stream_event_rail.py:L983-L985
- 源页字段（feature）：harness
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/interface_deep.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/agents/harness/common/rails/*
