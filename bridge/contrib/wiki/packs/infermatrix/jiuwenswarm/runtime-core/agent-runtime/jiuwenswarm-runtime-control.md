---
name: jiuwenswarm-runtime-control
description: Runtime 交互输入、执行取代与取消：deliver_control 父执行与 claim 四元组、心跳链与流式投递、stream_session_input 补充输入语义、新工作取代 WAITING_FOR_CONTROL 执行、cancel_execution 选择器与 CancelExecutionResult
metadata:
  scope: 只收 control 投递、补充输入、取代与取消四块工作流；会话注册与 lane 调度归 jiuwenswarm-runtime-session-1，关闭归 jiuwenswarm-runtime-session-2，unary 与流式执行归 jiuwenswarm-runtime-execution
---
# Runtime 交互输入、执行取代与取消

## 现状

### 职责和边界

- 协调等待交互的执行、补充输入、工作取代和子执行取消；会话注册、lane 调度与关闭由 Runtime Session 主页面说明。

#### control 投递与心跳链

- `deliver_control` 的父执行 = 当前 generation 里活跃、`waiting_control_id == request_id` 且状态 RUNNING/WAITING_FOR_CONTROL 的最新者（按 started_at/created_at 取 max）；
  - 找不到抛 "session has no active execution"（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L881-L901)）。
- claim 是四元组 (session_id, generation, parent_execution_id, request_id)，重复投递抛 "control input is already being delivered"。claim 先加、子执行创建仍可能失败：失败时 finally 释放 claim，
  - 父执行保持可重试——泄漏的 claim 或被恢复却无人接手的父都会把问题永久卡死（源码注释；测试 `test_failed_control_setup_releases_claim_and_parent`）（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L293-L316)）。
- 投递完成时若父已终态/记录被替换/会话 QUIESCING 或 CLOSED：子记 CANCELLED 并抛
  - `SessionExecutionEndedError`（"control input arrived after its execution ended: ..."）（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L338-L352)；
  - 测试 `test_control_result_after_parent_ended_raises_typed_error`）。
- control 子执行失败/被取消：子记 CANCELLED/FAILED；父若原本在等且未终态，重新 mark_awaiting_control + mark_waiting，答案可以重试；
  - 取消 control 子执行不会取消父工作（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L320-L336)；测试 `test_control_input_cancellation_does_not_cancel_parent_work`）。
- 链式追问：control 操作自己的 `suspension_key` 又给出 control_id 时，若有 HEARTBEAT 祖先（`_heartbeat_root` 沿 parent 链、限同 session+generation 查找），则把心跳根重新挂起（waiting）、control 子记 SUCCEEDED；无心跳根时挂起 control 子自身。普通父等到答案后 SUCCEEDED；
  - 若父已发布更新的 waiting_control_id 则不覆盖（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L354-L377)、
  - [L934-L953](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L934-L953)；测试 `test_control_input_resumes_work_after_output_stream_ends`）。
- `deliver_control_stream` 是流式版：观察在操作结束前就可见（包括第二个问题），claim 用 per-record 的 `stream_control_claims`（按 request_id），重复抛 "interaction answer is already in progress"；父只认已存在的匹配交互，绝不认一次新对话轮。
  - 消费者拥有该 generator，退出时必须 close（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L404-L495)）。
- `record_interaction` 供被拥有的回调执行中登记交互：仅当会话 ACTIVE 且找到 RUNNING 的匹配 request_id 才写 waiting_control_id 并刷新 gate，返回 bool（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L265-L282)）。
  - `has_control_target` / `control_target_work_kind` 供宿主预判 control 能否送达及其根工作类型。

#### 补充输入（stream_session_input）

- 语义：输入不恢复、不完成、也不替换等待中的交互。会话里任一活跃执行在等答案 → `SessionInputRejectedError`（"session is waiting for an interaction answer; supplemental input was not sent"）；父执行正在取消 → 同样拒绝；
  - `expected_execution_id` 与当前父不符 → `SessionInputTargetError`（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L497-L546)；两个异常定义在 `jiuwenswarm/runtime/session_input.py`）。
- 有父（RUNNING 且非 SESSION_INPUT/GOAL_CONTROL/GOAL_ATTACH）时以 SESSION_INPUT 挂到父执行并传 `operation(record.channel_id)`；无父时作为新 CHAT_STREAM 走 `idle_operation` 兜底。

#### 新工作取代等待中的执行

- 新 CHAT_UNARY/CHAT_STREAM 会把同 generation 中 WAITING_FOR_CONTROL 的 CHAT_UNARY/CHAT_STREAM/HEARTBEAT 记 `cancellation_requested=True` 并置 CANCELLED；
  - 新 GOAL_STREAM 同理取代 WAITING_FOR_CONTROL 的 GOAL_STREAM/GOAL_ATTACH（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L811-L836)；测试 `test_new_work_supersedes_waiting_control`）。

#### 取消（cancel_execution）

- 选择器：request_id / execution_id / 整个 session（均 active_only），先经 `_with_descendants` BFS 扩展子执行，范围限同 (session_id, generation)（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L648-L679)、
  - [L955-L979](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L955-L979)；测试 `test_cancel_by_request_execution_and_session`）。
- 两条取消路径：scheduled 类走 `SessionWorkScheduler.cancel_handles`；
  - SESSION_MESSAGE（虽属 scheduled）和非 scheduled 类按 `_requires_direct_cancel` 直接 cancel 其 asyncio 任务（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L852-L856)）。
  - 等待默认 `cancel_timeout=5.0` 秒，调用可用 `wait_timeout` 覆盖。
- 结果 `CancelExecutionResult(matched, cancelled, timed_out)`：超时未退出的执行保持原状态（如 RUNNING）且 `cancellation_requested=True`，仍被登记表跟踪；
  - 未超时的非终态一律强制记 CANCELLED（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L680-L692)；测试 `test_cancel_timeout_keeps_resistant_execution_tracked`）。

### 怎样验证

- 源码链接固定在 f0a69728c96b5961d993449f1a901cbd2f4dac5b。聚焦单测选择器和验证范围见[[jiuwenswarm-runtime-session-2]]（原模块页面；源锚点 #怎样验证）；单元契约不能替代真实服务、模型端点或跨平台集成验证。

### 相关文档

- [[jiuwenswarm-runtime-session-1]]、[[jiuwenswarm-runtime-session-2]]（原模块架构与入口）
- [[jiuwenswarm-runtime-cron]]（相邻模块）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/jiuwenswarm-runtime-control.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session/coordinator.py
