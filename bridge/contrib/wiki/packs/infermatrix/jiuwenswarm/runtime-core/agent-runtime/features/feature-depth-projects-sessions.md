---
name: feature-depth-projects-sessions
description: 项目、会话与历史管理实现深读：session_catalog.py list_sessions 的投影过滤与模式归一、SessionListInput 校验与分页输出、分页默认值 20/上限 200、活体两轮恢复门测、协调器 close 超时先抛错与 cancel_all 委托、get_session 的 READ_FAILED 包装
metadata:
  scope: 收会话目录（session_catalog.py）与协调器关闭的实现级证据，来源另含 coordinator.py、mode_matrix.py、service.py、test_process_cli_session_runtime_live.py、work_scheduler.py；功能概览、接口入口与验证步骤归 feature-projects-sessions-1、feature-projects-sessions-2
---
# 项目、会话与历史管理：实现深读

## 现状

- [[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（功能概览） · [[agent-runtime-overview]]（owner 入口）
- **会话列表查询链路：list_sessions 投影过滤到模式归一** 调用方传入 SessionListInput（channel_id、limit/offset、search）。list_sessions 先校验 channel 与分页，再遍历 _collect_session_metadata 的每条 metadata：_project_session 按 channel_id 归一比较、经 _single_agent_mode 用 deprecate_mode 把旧 canonical 模式映射到新值并只保留单 Agent 模式，最后构造 SessionSummary；
  - 命中 search 词的项按 last_message_at 降序排序并切片分页，返回 SessionListResult。
- 调用路径：`jiuwenswarm/runtime/session_catalog.py`（`list_sessions`） → `jiuwenswarm/runtime/session_catalog.py`（`_project_session`） → `jiuwenswarm/runtime/session_catalog.py`（`_single_agent_mode`） → `jiuwenswarm/common/mode_matrix.py`（`deprecate_mode`）
- 来源：[jiuwenswarm/runtime/session_catalog.py:L230–L281](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L230-L281),
  - [jiuwenswarm/runtime/session_catalog.py:L162–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L162-L188),
  - [jiuwenswarm/runtime/session_catalog.py:L156–L159](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L156-L159),
  - [jiuwenswarm/common/mode_matrix.py:L309–L326](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/mode_matrix.py#L309-L326)
- **list_sessions 的输入契约与分页输出** 调用方必须传入 SessionListInput 实例：channel_id 去除首尾空白并转小写后非空，否则抛 SessionCatalogError(code="BAD_REQUEST")；limit 必须是 1..200 的整数（排除 bool），offset 为非负整数；search 必须是长度 ≤200 的字符串。
  - 通过后按 last_message_at 降序、session_id 升序排序，返回 SessionListResult 页（sessions/total/limit/offset），total 是过滤后的总数而非当前页大小。
- 来源：[jiuwenswarm/runtime/session_catalog.py:L230–L281](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L230-L281),
  - [jiuwenswarm/runtime/session_catalog.py:L94–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L94-L98),
  - [jiuwenswarm/runtime/session_catalog.py:L119–L131](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L119-L131)
- **分页默认值与上限** 模块常量 _DEFAULT_LIMIT=20、_MAX_LIMIT=200；_validate_page 强制 limit 为 1..200 的 int（bool 显式排除），offset 为非负 int，否则抛 "limit must be between 1 and 200" / "offset must be a non-negative integer"（code="BAD_REQUEST"）。文档侧 session.list 同样写明 limit 默认 20、最大 200。
- 来源：[jiuwenswarm/runtime/session_catalog.py:L119–L131](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L119-L131),
  - [jiuwenswarm/runtime/session_catalog.py:L1–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L1-L19),
  - [docs/zh/项目与会话管理.md:L130–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L130-L149)
- **活体两轮恢复门测** tests/system_tests/test_process_cli_session_runtime_live.py::test_process_cli_two_turn_session_resume_live 通过 app.run 跑两轮对话，断言第二轮返回同一 session_id、load_history_records 记录数增长，且协调器快照 state 为 CLOSED、所有 execution 终态。
  - 该测试带 system/slow 标记，仅在 RUN_LIVE_SESSION_RUNTIME_TESTS=1/true/yes 时执行（需真实模型），此处仅记录入口与断言范围，不代表当前已通过。
- 来源：[tests/system_tests/test_process_cli_session_runtime_live.py:L78–L142](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/system_tests/test_process_cli_session_runtime_live.py#L78-L142),
  - [tests/system_tests/test_process_cli_session_runtime_live.py:L24–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/system_tests/test_process_cli_session_runtime_live.py#L24-L31)
- **协调器超时先抛错、无超时才关调度器；Runtime cancel_all 委托 AgentManager** 协调器 close：timed_out 非空先抛 SessionCloseTimeoutError，否则才以 self._cancel_timeout 调 self._scheduler.close（默认 wait_timeout=5.0 被覆盖）；AgentRuntime.cancel_all_inflight_work 经 _closed 守卫（否则抛 RuntimeStateError）委托 _agent_manager 同名方法。
- 来源：[jiuwenswarm/runtime/session/coordinator.py:L763–L789](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L763-L789),
  - [jiuwenswarm/runtime/session/work_scheduler.py:L132–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/work_scheduler.py#L132-L152),
  - [jiuwenswarm/runtime/service.py:L1120–L1140](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1120-L1140)
- **get_session：非目录异常包装为 READ_FAILED，空元数据返回 None** 在 `get_session` 中，`_read_session_metadata` 抛出的 `SessionCatalogError` 原样上抛；其余 `Exception` 被包装为 `SessionCatalogError("failed to read session", code="READ_FAILED")` 并以 `from None` 传播给调用方；若读到的 metadata 为空或非 Mapping，则返回 None 而不抛错。
- 来源：[jiuwenswarm/runtime/session_catalog.py:L211–L227](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L211-L227)
- **Coordinator.close 聚合各会话关闭异常但只抛 errors[0]；timed_out 非空时在调度器关闭前抛 SessionCloseTimeoutError** 设计推断（非作者历史意图）：
- 收益（推断）：单条 close_session 异常仅追加进 errors，循环继续关闭其余 record（772-779）；代价：无超时时只有 errors[0] 向上传播（788-789），timed_out 非空则 780-783 在 785 的 _scheduler.close 之前抛出，该分支跳过调度器关闭。
- 来源：[jiuwenswarm/runtime/session/coordinator.py:L763–L789](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L763-L789)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/feature-depth-projects-sessions.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_catalog.py:L230-L281；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_catalog.py:L162-L188
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_catalog.py:L156-L159；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/mode_matrix.py:L309-L326
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_catalog.py:L119-L131；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_catalog.py:L1-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/项目与会话管理.md:L130-L149；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/system_tests/test_process_cli_session_runtime_live.py:L78-L142
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/system_tests/test_process_cli_session_runtime_live.py:L24-L31；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_catalog.py:L94-L98
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_catalog.py:L211-L227；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session/coordinator.py:L763-L789
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session/work_scheduler.py:L132-L152；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1120-L1140
- 源页字段（feature）：projects-sessions
- 入口（entry_points）：jiuwenswarm/runtime/session_catalog.py；jiuwenswarm/runtime/session_lifecycle.py
- 源页字段（source_globs）：jiuwenswarm/runtime/session_catalog.py；jiuwenswarm/runtime/session_lifecycle.py；jiuwenswarm/runtime/session*.py
