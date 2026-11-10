---
name: jiuwenswarm-runtime-session-2
description: Runtime Session 协调器（下）：close_session 与 close() 关闭流程、QUIESCING 与超时、会话状态刷新与 control gate、test_runtime_session_coordinator.py 的验证选择器、相关文档与改动路由
metadata:
  scope: 只收关闭与停机、会话状态与 control gate、怎样验证、相关文档；职责、源码入口、准入与 lane 调度归 jiuwenswarm-runtime-session-1
---
# Runtime Session 协调器（jiuwenswarm/runtime/session/）（2/2）

## 现状

- 拆分说明：本页是源页 `jiuwenswarm-runtime-session.md` 的第 2/2 部分；第 1 部分 [[jiuwenswarm-runtime-session-1]]

### 关闭与停机

- `close_session(session_id, generation=None)`：记录不存在或 generation 不符 → `CloseSessionResult(existed=False)`。流程：置 QUIESCING → 直接取消 active 的 direct 类 → 关闭该 generation 的 lane（清队列、取消 processor）→ 等待 settling（retain_owner_task 的终态执行，或无 lane 时仍有活任务的 scheduled 执行）→ 未超时的残留 active 强制 CANCELLED → 无超时才置
  - CLOSED（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L694-L753)；测试 `test_close_session_cancels_goal_stream`）。
- 有 timed_out 时会话停留在 QUIESCING：新工作被 "not accepting work" 拒绝，同 generation 重试 close 时，仍未退出的执行可继续被报告为超时；旧执行全部退出后再次 close 才 CLOSED，此后 register 分配 generation+1（测试 `test_old_generation_completion_does_not_clear_new_generation`）。
- `close()`：锁内置 `_accepting=False`，逐会话 close_session；任何超时汇总为 `SessionCloseTimeoutError("runtime", ids)` 并先抛出；
  - 没有该超时才继续关 scheduler，其余异常抛第一个（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L763-L789)；测试 `test_close_stops_new_work_and_cancels_active_execution`）。

### 会话状态与 control gate

- `_refresh_session_state`：非 QUIESCING/CLOSED 时，有活跃执行 → ACTIVE，否则 READY；记录已被替换则不动（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L1059-L1070)）。
- `_refresh_control_gate`：任一活跃执行带 waiting_control_id 就清 `control_ready`，否则置位——这是 SESSION_MESSAGE 排队等待的闸门（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L1072-L1086)）。

### 怎样验证

- 焦点测试文件：`tests/unit_tests/runtime/test_runtime_session_coordinator.py`（`pytestmark = pytest.mark.unit`，asyncio 用例），[upstream 链接](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_runtime_session_coordinator.py)。按主题的精确选择器：
  - 排序/并行/上下文：`test_latest_first_within_session_and_parallel_across_sessions`、`test_contextvars_are_captured_for_each_queued_operation`、`test_session_messages_wait_for_control_and_keep_fifo_order`
  - 消息闸门与幂等：`test_submitted_session_message_starts_without_active_execution`、`test_session_message_waits_for_heartbeat_interaction`、`test_submitted_session_message_is_idempotent_by_request_id`、`test_admitted_session_message_stream_bypasses_user_waiting_in_lane`、
    - `test_cancel_session_message_while_it_waits_for_control`
  - 取消：`test_cancel_by_request_execution_and_session`、`test_cancelling_unary_caller_also_stops_owned_operation`、`test_cancel_queued_request_never_runs_its_operation`、`test_cancel_timeout_keeps_resistant_execution_tracked`、`test_external_stream_cancel_unblocks_consumer`、
    - `test_interrupted_descendant_cancel_keeps_child_tracked`
  - 流式：`test_stream_early_close_cancels_producer_and_waits_for_exit`、`test_goal_stream_runs_while_chat_lane_is_busy`、`test_close_session_cancels_goal_stream`
  - control：`test_control_input_bypasses_running_session_work_lane`、`test_control_input_resumes_work_after_output_stream_ends`、`test_control_input_matches_goal_interaction_id`、`test_control_input_requires_running_session_work`、`test_control_input_cancellation_does_not_cancel_parent_work`、
    - `test_failed_control_setup_releases_claim_and_parent`、`test_control_result_after_parent_ended_raises_typed_error`、`test_new_work_supersedes_waiting_control`
  - 登记/关闭/generation：`test_registry_retains_only_bounded_terminal_history`、`test_retained_terminal_owner_is_not_evicted_before_task_exit`、`test_swallowed_deadline_cancellation_is_still_failed`、`test_close_stops_new_work_and_cancels_active_execution`、
    - `test_old_generation_completion_does_not_clear_new_generation`
- 验证边界：这些选择器来自固定版本的源码与既有断言，覆盖进程内异步协调行为；不能单独证明生产生命周期接线、集成或硬件行为。
  - `SessionInputTargetError` 继承 `SessionInputRejectedError`，两者分别带稳定的错误码 `SESSION_INPUT_TARGET_CHANGED` / `SESSION_INPUT_REJECTED`（[session_input.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_input.py#L15-L24)）。
- **相关文档**
- [[jiuwenswarm-runtime]]（共享 Agent Runtime（jiuwenswarm/runtime）） — 上一层入口：AgentRuntime、请求规范化与会话 provision 契约；本页只覆盖 `runtime/session/` 子包。
- [[jiuwenswarm-runtime-cron]]（定时任务（Cron）运行时） — HEARTBEAT 执行的产生方在 cron 侧；心跳链在本页的挂起/恢复语义里。
- `TESTING.md` — 为本模块新增或修改测试时参考。其中部分路径可能已过期，先对照 tests/ 下已有的用例。
- **改动路由**
- `jiuwenswarm/runtime/session/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/jiuwenswarm-runtime-session.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
