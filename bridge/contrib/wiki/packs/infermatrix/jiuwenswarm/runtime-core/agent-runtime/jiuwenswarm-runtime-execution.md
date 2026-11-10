---
name: jiuwenswarm-runtime-execution
description: Runtime unary 与流式执行：run_unary/submit_unary 与去重、超时与取消的区分、wait_for_terminal 终态 owner、run_stream 有界队列与消费者提前退出、lane 使用规则
metadata:
  scope: 只收 unary 与流式执行两块；会话注册与 lane 调度归 jiuwenswarm-runtime-session-1，关闭归 jiuwenswarm-runtime-session-2，control 投递与取消归 jiuwenswarm-runtime-control
---
# Runtime unary 与流式执行

## 现状

### 职责和边界

- 说明已准入会话工作如何提交 unary 操作、处理 deadline、保留终态 owner 并解耦流生产者与消费者；会话注册、lane 调度与关闭见[[jiuwenswarm-runtime-session-1]]、[[jiuwenswarm-runtime-session-2]]（协调器主页面）。

#### unary 执行

- `run_unary` 在调用方任务里 await 完成并返回值；`submit_unary` 排后台任务、立刻返回 QUEUED 快照。`submit_unary` 在对应记录仍留在 registry 时，按 (session_id, request_id, generation) 去重：重复提交返回同一 execution 快照；
  - 终态记录被 TTL/容量淘汰后，同一 request_id 可创建新执行，work_kind 不一致抛 `ValueError("request_id already belongs to ...")`（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L127-L159)）。
- `submit_unary` 的 SESSION_MESSAGE 先 `await record.control_ready.wait()`：会话里有执行在等交互答案时，
  - 排队消息不会被调度（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L151-L154)；测试 `test_session_message_waits_for_heartbeat_interaction`）。
- 超时与取消的区分：`timeout_scope`（`asyncio.Timeout`）expired 时，CancelledError 记 FAILED（error=timeout_error，默认 "execution deadline exceeded"）而非 CANCELLED；
  - 操作吞掉取消返回"迟到成功"也照样记 FAILED 并向调用方抛 `TimeoutError`（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L177-L201)；测试 `test_swallowed_deadline_cancellation_is_still_failed`）。
- `wait_for_terminal=True` 置 `retain_owner_task`；非 scheduled 工作（例如 HEARTBEAT）拿到值后等 `terminal_event`，终态 CANCELLED 抛 CancelledError、FAILED 抛 RuntimeError；
  - owner task 退出前该终态执行不被登记表淘汰（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L226-L232)；测试 `test_retained_terminal_owner_is_not_evicted_before_task_exit`）。
- 调用方任务被取消时：scheduled 的先经 scheduler 取消，未到终态则记 CANCELLED，随后级联取消子执行（`_cancel_descendants`）再刷新会话状态；
  - 其他异常同样取消子执行（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L234-L256)；测试 `test_cancelling_unary_caller_also_stops_owned_operation`）。
  - 子执行取消被再次打断时，会不可中断地等它们退出（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L1044-L1057)；测试 `test_interrupted_descendant_cancel_keeps_child_tracked`）。

#### 流式执行（run_stream）

- 生产者/消费者经有界 `asyncio.Queue`（默认 64）解耦；生产者对每个条目跑 `suspension_key`，产出 control_id 就 mark_awaiting_control 并刷新 gate；
  - 终止标记（done/error）即使缓冲满也必须投递，否则消费者在最后一个数据项之后会永远等待（源码注释明说）（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L565-L614)）。
- 消费者提前退出（aclose/异常）且生产任务未完成时，协调器对该 handle 调 `cancel_execution`，在取消等待期限内等待生产者；抵抗取消并超时的任务仍由 registry
  - 跟踪（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L625-L646)；测试 `test_stream_early_close_cancels_producer_and_waits_for_exit`、`test_external_stream_cancel_unblocks_consumer`）。
- lane 使用规则：`scheduled` 且不是 SESSION_MESSAGE 才进 lane——流式 mailbox 消息已持有宿主准入，排进聊天 lane 会死锁在等待该准入的用户轮次后面（源码注释）；GOAL_STREAM 非 scheduled 不占 lane，聊天占用 lane
  - 时仍可运行（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L616-L624)；测试 `test_admitted_session_message_stream_bypasses_user_waiting_in_lane`、`test_goal_stream_runs_while_chat_lane_is_busy`）。

### 怎样验证

- 焦点用例与验证范围见[[jiuwenswarm-runtime-session-2]]（协调器验证入口；源锚点 #怎样验证）。这里只记录固定源码 f0a69728c96b5961d993449f1a901cbd2f4dac5b 的进程内契约，不代替真实生产生命周期验证。

### 相关文档

- [[jiuwenswarm-runtime-session-1]]、[[jiuwenswarm-runtime-session-2]]（Runtime Session 的准入、状态与关闭）
- [[jiuwenswarm-runtime-control]]（Runtime 交互输入、执行取代与取消）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/jiuwenswarm-runtime-execution.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session/coordinator.py
