---
name: jiuwenswarm-runtime-session-1
description: Runtime Session 协调器（上）：包公开导出与会话准入、主要源码入口（coordinator、execution_registry、work_scheduler、model）、register_session 与 generation、执行登记表状态机与终态淘汰、lane 调度与优先级
metadata:
  scope: 只收职责边界、源码入口与数据流（会话准入、登记表、lane 调度）及指向执行与控制专题的链接；关闭与停机、会话状态与 control gate、验证与相关文档归 jiuwenswarm-runtime-session-2
---
# Runtime Session 协调器（jiuwenswarm/runtime/session/）（1/2）

## 现状

- 拆分说明：本页是源页 `jiuwenswarm-runtime-session.md` 的第 1/2 部分；第 2 部分 [[jiuwenswarm-runtime-session-2]]
- 负责产品层 Session 的生命周期和执行协调，包括注册与关闭会话、调度单次（unary）和流式执行、投递 control 请求，以及取消执行及其子执行。另外维护一个有容量上限的执行登记表，记录排队中、运行中和最近结束的执行，并为每个 Session 提供一个工作调度器。它只拥有临时（ephemeral）执行状态，不是持久 Session 元数据/历史的仓库——coordinator 与 registry 的类 docstring 都这样声明。
- 本页源码结论固定在 upstream commit `f0a6972`（f0a69728c96b5961d993449f1a901cbd2f4dac5b），行号见各 GitHub blob 链接。

### 职责和边界

- 包级公开导出只有六个名字：`RuntimeSessionCoordinator`、`RuntimeSessionState`、`SessionCloseTimeoutError`、`SessionExecutionEndedError`、`SessionPersistencePolicy`、
  - `SessionWorkKind`（[session/\_\_init\_\_.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/__init__.py#L3-L19)）；registry、scheduler、handle/snapshot 类型需从子模块导入。
- 新执行与输入准入入口先过 `_require_open_session`：先调用 `jiuwenswarm/server/runtime/session/lifecycle.py` 的 `guard(session_id)` 检查会话归档、删除和进行中的生命周期操作，
  - 以及所属项目的生命周期门（函数内 import；[lifecycle.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/session/lifecycle.py#L389-L427)），
  - 再拒绝未注册（"session is not registered"）与 QUIESCING/CLOSED（"session is not accepting work"）（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L791-L801)）。
- 协调器整体 `close()` 后 `_accepting=False`，此后 `register_session` 抛 "session coordinator is closed"。
- 两个专职异常都在 `model.py`：`SessionExecutionEndedError` 刻意不是 `asyncio.CancelledError`（投递任务从未被取消，报成取消会让上游流处理器把真实失败当成静默中止）；
  - `SessionCloseTimeoutError` 携带 session_id 与仍存活的 execution_ids（[model.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/model.py#L12-L30)）。

### 主要源码和调用入口

- `jiuwenswarm/runtime/session/coordinator.py` — `RuntimeSessionCoordinator` 是对外入口：`register_session`、`run_unary`/`submit_unary`、`run_stream`/`stream_session_input`、`deliver_control`/`deliver_control_stream`/`record_interaction`/`has_control_target`/`control_target_work_kind`、`cancel_execution`、
  - `close_session`/`close`、`get_execution`/`snapshot_session`。构造默认 `cancel_timeout=5.0`、`stream_buffer_size=64`（最小 1）（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L56-L72)）。
- `jiuwenswarm/runtime/session/execution_registry.py` — `SessionExecutionRegistry` 负责执行状态流转（QUEUED/RUNNING/WAITING_FOR_CONTROL/terminal），终态记录按容量和 TTL 淘汰。
- `jiuwenswarm/runtime/session/work_scheduler.py` — `SessionWorkScheduler` 为每个 Session 分配一条 lane（按 generation 区分），负责排队执行、取消排队项、关闭时清空队列。
- `jiuwenswarm/runtime/session/model.py` — 共享模型：会话/执行状态枚举、`SessionWorkKind`、执行句柄与快照、取消和关闭的结果，以及超时和已结束异常。

### 数据怎样流动

#### 会话准入与 generation

- `register_session`：session_id 去空白后为空抛 `ValueError`；新记录（不存在或已 CLOSED）的 generation = `_generations` 计数 +1，跨关闭单调递增；已存在且未 CLOSED 时只更新 channel_id（仅传入真值时）和 persistence_policy，不换 generation；
  - channel_id 缺省 "default"（[coordinator.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/coordinator.py#L74-L100)）。
- QUIESCING 期间重复 register 返回同一 generation 且状态仍为 QUIESCING；只有 `close_session` 真正置 CLOSED 后，下一次 register 才分配 generation+1（焦点测试 `test_old_generation_completion_does_not_clear_new_generation`）。

#### 执行登记表：状态机与终态淘汰

- 通常从 QUEUED 开始并进入 RUNNING；等待交互时可进入 WAITING_FOR_CONTROL 再恢复 RUNNING，也可不经等待直接结束。SUCCEEDED/FAILED/CANCELLED 为终态，排队取消也可直接进入 CANCELLED（[model.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/model.py#L71-L85)）。
  - `mark_running` 只在 QUEUED 时生效并写 `started_at`；`mark_awaiting_control` 只对非终态写 `waiting_control_id`；`mark_waiting` 进入 WAITING_FOR_CONTROL 并清 `handle.task`（`retain_owner_task` 除外）；
  - `resume_waiting` 只从 WAITING_FOR_CONTROL 回 RUNNING（[execution_registry.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/execution_registry.py#L39-L64)）。
- `mark_terminal` 必须给终态（否则 `ValueError`），对已终态幂等（只补 `terminal_event`）；
  - 落终态时清 `waiting_control_id`、写 `finished_at`、error 字符串化，task 未保留时清空并把执行放进淘汰队列（[execution_registry.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/execution_registry.py#L66-L88)）。
- 终态历史有界：默认 `terminal_capacity=512`、`terminal_ttl=900.0` 秒（capacity<0 报错）。淘汰按 TTL 过期或超容量触发，且只有 `handle.task is None or task.done()` 才真正删索引；
  - `retain_owner_task` 的终态执行要等 owner task 退出（`release_owner_task`）后才可被淘汰（[execution_registry.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/execution_registry.py#L19-L27)、
  - [L147-L164](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/execution_registry.py#L147-L164)）。
- `select` 支持 execution_id / (session_id, request_id) / session_id 三种键，可过滤 generation 与 active_only，结果按 `created_at` 排序，
  - 快照顺序稳定（[execution_registry.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/execution_registry.py#L105-L131)）。

#### lane 调度

- `SessionWorkKind` 九种；`scheduled` 只含 CHAT_UNARY/CHAT_STREAM/SESSION_MESSAGE（进 lane），`latest_first` 只含两种 CHAT（[model.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/model.py#L44-L68)）。
- 每个 Session 一条 lane，lane 绑定 generation；`_ensure_lane` 遇 generation 不匹配抛 "session generation mismatch"。
  - lane 内一次只跑一个 operation，Session 之间并行（[work_scheduler.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/work_scheduler.py#L154-L166)）。
- 优先级分组：`latest_first` 的 CHAT 进 group 0（priority 随提交递减，越新越先跑），其余 scheduled（SESSION_MESSAGE）进 group 1 按 sequence FIFO——新聊天会插到排队消息前面（[work_scheduler.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/work_scheduler.py#L55-L63)；
  - 测试 `test_latest_first_within_session_and_parallel_across_sessions`、`test_session_messages_wait_for_control_and_keep_fifo_order`）。
- 提交时 `contextvars.copy_context()`，processor 用 `asyncio.create_task(op, context=...)` 在快照上下文执行：排队项看到的是提交时的上下文，
  - 调用方之后改 ContextVar 不影响它（[work_scheduler.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/work_scheduler.py#L181-L183)；测试 `test_contextvars_are_captured_for_each_queued_operation`）。
- 取消排队项不动 PriorityQueue（没有删除操作）：cancel 它的 result future，processor 取出时发现 result 已取消就跳过、
  - 不执行该操作（[work_scheduler.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session/work_scheduler.py#L217-L223)；测试 `test_cancel_queued_request_never_runs_its_operation`）。

#### unary 与流式执行

- 提交、deadline、终态 owner 保留与生产者/消费者清理见[[jiuwenswarm-runtime-execution]]（Runtime 执行专题）。

### Runtime 交互输入、执行取代与取消

- 该工作流的职责、顺序、错误边界与源码入口见[[jiuwenswarm-runtime-control]]（Runtime 交互输入、执行取代与取消）。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/jiuwenswarm-runtime-session.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session/coordinator.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session/execution_registry.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session/work_scheduler.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session/model.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session/__init__.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_runtime_session_coordinator.py
