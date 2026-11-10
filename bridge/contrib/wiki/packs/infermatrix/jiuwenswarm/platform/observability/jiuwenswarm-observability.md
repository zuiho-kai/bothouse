---
name: jiuwenswarm-observability
description: 可观测性：AgentServer 轨迹采集、每会话 SQLite 存储与保留（jiuwenswarm/observability）：准入校验、有界双队列与快照合并、锁忙重试与冲突 first-wins、每会话路由与孤儿缓冲、会话删除墓碑、验证入口
metadata:
  scope: 只收轨迹准入、队列、批量提交、会话路由与会话删除的数据流和入口文件；整页保留、检查点与 OTLP 校验归 jiuwenswarm-trajectory-retention
---
# 可观测性：Agent 轨迹采集、存储与保留（jiuwenswarm/observability）

## 现状

- 在 AgentServer 中接收 Core 产出的 OTLP span 记录，按会话写入本地 SQLite 轨迹库，并为轨迹查看器提供读取查询、按页保留清理和会话删除。它也负责维护会话的轮次（turn）身份，并把已提交的轨迹修订提示跨进程推送到 Gateway。
- 本页源码结论固定在 upstream commit `f0a6972`（f0a69728c96b5961d993449f1a901cbd2f4dac5b），行号见各 GitHub blob 链接；结论来自对该 checkout 的静态阅读，未执行任何测试。
- **从哪里读起**
- `jiuwenswarm/observability/runtime.py` — AgentServer 的轨迹运行时生命周期：start/sync/shutdown_trajectory_runtime 向 Core 注册或注销记录消费者；get_trajectory_runtime_sink 返回当前的 sink
- `jiuwenswarm/observability/session_delete.py` — 产品 Session 删除时的轨迹生命周期：begin/abort/commit_trajectory_session_delete，以及 trajectory_session_accepts_records
- `jiuwenswarm/observability/turn.py` — SessionTurnTracker/TurnIdentity：定义一个 ReAct 循环何时开启新轮次，以及 HITL 恢复、steer、supplement、cancel 各自的处理方式
- `jiuwenswarm/observability/gateway_hints.py` — TrajectoryGatewayHintBridge：把已提交的轨迹更新（CommittedTraceUpdate）作为修订提示，跨进程排队推送给 Gateway
- **关键文件**
- `jiuwenswarm/observability/sink.py` — 有界的记录消费者和 SQLite 写线程：TrajectoryRecordSink 负责批量写入与重试；TrajectorySessionSinkRouter 按会话路由写入，并处理删除和过期库清扫
- `jiuwenswarm/observability/store.py` — TrajectoryStore 负责无损写入、按保留规则删除过期数据和写检查点；AsyncTrajectoryReader 提供查看器使用的读取查询
- `jiuwenswarm/observability/retention.py` — 按页的保留规划：只删除最旧的连续整页轮次，并留下检查点，保证剩余部分的渲染结果不变
- `jiuwenswarm/observability/otlp_payload.py` — 严格的 OTLP JSON 解析，要求数值有限并限制嵌套深度，决定记录是否可以交给查看器投影；读取和保留两处共用这一规则
- `jiuwenswarm/observability/models.py` — 持久化边界上的类型化记录，包括 TraceRecordData、StreamFrameData、CommittedTraceUpdate、TraceSinkStats，以及它们从 Core 记录转换而来的方法
- `jiuwenswarm/observability/config.py` — TrajectoryStoreSettings：读取轨迹存储配置，并解析每个会话的数据库路径
- **改动路由**
- `jiuwenswarm/observability/`

### 数据怎样流动

#### 准入：只验身份，载荷留给写线程

- 路由器 `_consume` 在调用线程上只校验身份：`session_id` 去空白后必须与原值一致（需要 strip 才干净即视为 malformed）、`trace_id`/`span_id` 去空白小写后非空，失败计 `failed` 不入队；
  - `raw_json` 完全不碰——Core 惰性编码它，读它会拖回完整 OTLP encode，载荷类型检查推迟到写线程的 `TraceRecordData.from_core_*`，`_write_batch` 拒绝单条坏记录而不让整批失败（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L815-L866)、
  - [sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L477-L497)）。
- 跨会话主体拒绝：`_record_owner_is_consistent` 要求 `execution_subject_session_id` 为空、等于 `session_id` 或以 `{session_id}_sub_` 开头，否则计 `failed` 并打 warning；
  - final 记录与快照共用该检查（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L62-L70)、
  - [sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L169-L177)）。测试：`test_sink_rejects_subject_session_owned_by_another_chat`、`test_sink_accepts_team_member_subject_session`。

#### 有界队列与溢出行为

- `TrajectoryRecordSink` 有两条独立有界队列（final 记录与流帧，`maxsize=queue_size`）加一个 `_snapshot_pending` OrderedDict；final 记录队列满时 `put_nowait` 抛 `Full`，非阻塞计 `dropped`+`dropped_final`，
  - 日志明确"SQLite fan-out dropped the record while other configured exporters remain unaffected"（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L90-L102)、
  - [sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L190-L205)；`test_sink_queue_full_drops_without_blocking` 断言 elapsed < 1.0s）。帧走独立队列，帧洪峰不会挤掉唯一的权威 final 记录（`test_frame_flood_never_displaces_a_final_record`）。
- 快照按 `(trace_id, span_id)` 最新 revision 合并：不大于已排队版本的 revision 计 `stale_ignored`；入队前 `record_revision` 必须可解析且 ≥1、身份非空否则计 `failed`；容量按 `_queue.qsize()+len(pending) >= queue_size` 判满，满时有 pending 才逐出最旧 pending 计 `evicted_provisional`；
  - 没有可逐出的 pending 则丢弃新快照（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L209-L259)）。
- 流帧绝不合并（每帧是后帧不会重述的增量），帧队列满计 `dropped_frames`，日志说明 live stream 将出现空洞直到该 span 的完整输出到达；单批最多 `max(batch_size, 512)`
  - 帧（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L261-L289)、[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L423-L440)）。

#### 批量提交与重试语义

- `_write_records_with_retry` 只重试消息含 "locked"/"busy" 的 `sqlite3.OperationalError`，且只有一次（0.05s 延迟），其余异常直接抛；整批失败时日志"records remain available only through existing exporters"并计 `failed`，记录不重新入队（避免无限 drain）。注释说明一次重试使两个 5 秒 busy 等待仍落在默认 15 秒 close
  - 期限内（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L42-L44)、[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L497-L537)）。
  - 测试：`test_sink_retries_transient_sqlite_contention`。
- records 与 frames 在 `write_records` 的同一 `BEGIN IMMEDIATE` 事务中提交（两个独立 watermark 原子推进）；
  - 成功后 `committed+=inserted`、`conflicts+=conflicts`，再在锁外回调 `on_commit(updates)`，回调异常只记日志不上抛（[store.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L465-L483)、
  - [sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L503-L512)）。
- final 记录冲突 first-wins：`INSERT ... ON CONFLICT(trace_id, span_id) DO NOTHING`，rowcount=0 时比较 `raw_sha256`（未压缩字节摘要，压缩不影响冲突判定）；
  - 相同则仍更新 current 行，不同则写 `otlp_record_conflicts` 并保留第一条原始记录（[store.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L500-L601)；`test_store_preserves_exact_raw_and_records_hash_conflict`）。
  - `discard_final_span_frames` 开启时，帧先尝试追加再由同批终态记录清理（[store.py:763-789](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L763-L789)）；
  - 此开关下，终态记录已落库后到达的迟到帧直接不入库（[store.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L604-L607)、
  - [store.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L719-L721)）。

#### 每会话路由、孤儿缓冲与 writer 退役

- 路由线程为每个会话惰性创建独立 writer（`replace(settings, database_path=session_database_path(...))`）；
  - `sink.start()` 失败的 writer 仍保持注册、靠自身计数器拒绝记录，避免逐条记录重试初始化拖住其它会话（`test_blocked_session_writer_does_not_delay_another_session`）（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L905-L919)）。
- 无 `session_id` 的记录进 `_orphan_pending` 有界缓冲，键为 `(trace_id, span_id[, sequence])`——帧额外加 `sequence`，因为帧是增量，仅按 span 键会让新帧顶掉旧帧留下空洞；
  - 满时逐出最旧，同 trace 的会话内 span 到达时一并路由，关闭时全部丢弃计数（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L944-L980)）。
- writer 空闲 ≥300s 且 `sink.is_idle()` 才退役；
  - `close(timeout=1.0)` 未停下的 writer 保持注册，防止对同一数据库开出第二个连接（`test_idle_retirement_keeps_writer_registered_when_close_times_out`）（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L45)、
  - [sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L921-L942)）。

#### 会话删除 begin/abort/commit

- 墓碑先于排水：`lifecycle.begin` 先置 PREPARED（`accepts_records` 立即为 false），再调 `backend.begin_session_delete`；backend 抛错则回滚墓碑并上抛（[session_delete.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/session_delete.py#L87-L103)）。
  - 墓碑会话的迟到记录在路由器 `_consume`（锁内外各查一次 `trajectory_session_accepts_records`）计 `dropped`，
  - 数据库不会被重新打开（`test_late_record_is_rejected_while_session_is_tombstoned`）（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L841-L851)）。
- `abort` 无论 backend 回滚是否抛错都在 finally 中移除墓碑（`test_abort_releases_tombstone_even_when_backend_rollback_fails`）；`lifecycle.commit` 先置 PREPARED，再交给 backend.commit；当前路由 backend 会先 begin 排水，再 unlink 数据库与 -wal/-shm sidecar，无 backend 时直接删除这些文件，可重复调用；
  - committed 墓碑上限 1024、prepared 永不逐出（`test_committed_tombstones_are_bounded`）（[session_delete.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/session_delete.py#L105-L137)、
  - [session_delete.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/session_delete.py#L165-L172)）。
- 路由器 `begin_session_delete` 只等待目标会话的 `_ingress_pending` 归零（不做进程级队列 join），超时抛 `RuntimeError`；
  - writer 未在期限内停止同样抛 `RuntimeError`（`test_session_delete_waits_only_for_target_ingress`）（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L715-L741)）。

### 轨迹保留、检查点与查看器投影边界

- 该工作流的职责、顺序、错误边界与源码入口见[[jiuwenswarm-trajectory-retention]]（轨迹保留、检查点与查看器投影边界）。

### 怎样验证

- 上游自带聚焦单测位于 `tests/unit_tests/observability/`：`test_trace_sink.py`（队列溢出、快照合并、重试：`test_sink_queue_full_drops_without_blocking`、`test_sink_coalesces_pending_live_snapshots_by_identity`、`test_sink_retries_transient_sqlite_contention`）、`test_session_trajectory_routing.py`（路由隔离与清扫）、
  - `test_trajectory_session_delete.py`（墓碑三段式）、`test_trajectory_retention.py`（整页删除与检查点累积）、`test_trace_store.py`（冲突、schema 丢弃、压缩往返）。本页引用的均为测试选择器，本轮未执行。
- 相邻知识：产品层会话生命周期与删除门见 [[jiuwenswarm-runtime-session-1]]、[[jiuwenswarm-runtime-session-2]]（Runtime Session 协调器），共享 Runtime 的会话 create/switch/fork/delete 语义见 [[jiuwenswarm-runtime]]（共享 Agent Runtime）。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/observability/jiuwenswarm-observability.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/store.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/session_delete.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/retention.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/otlp_payload.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/models.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/observability/test_trace_sink.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/observability/test_session_trajectory_routing.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/observability/test_trajectory_session_delete.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/observability/test_trajectory_retention.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/observability/test_trace_store.py
