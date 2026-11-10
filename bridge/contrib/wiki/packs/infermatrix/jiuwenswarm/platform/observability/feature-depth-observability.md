---
name: feature-depth-observability
description: 执行轨迹与保留实现深读：帧队列满降级、_write_batch 坏记录计数、TrajectoryRecordSink.close 超时语义、会话库 SHA-256 路径、AsyncTrajectoryReader 的 schema 版本依赖、usage/raw 读取单测、consume 满队列取舍
metadata:
  scope: 只收 observability 实现层深读条目（失败模式、流程、API、配置、依赖、验证、取舍）；功能概览归 feature-observability
---
# 执行轨迹与保留：实现深读

## 现状

- [[feature-observability]]（功能概览） · [[observability-overview]]（owner 入口）
- **帧队列满的降级行为** consume_stream_frame 在 _frame_queue.put_nowait 抛 queue.Full 时不阻塞也不重试：计 dropped 与 dropped_frames，打 warning 说明实时流将出现缺口直到该 span 的完整输出随终态记录到达，然后正常返回。另一个触发点是 _record_owner_is_consistent 拒绝跨会话主体（subject_session 既非空也非 owner 或 owner_sub_ 前缀）时计 failed 直接丢弃。
- 来源：[jiuwenswarm/observability/sink.py:L261–L289](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L261-L289),
  - [jiuwenswarm/observability/sink.py:L62–L70](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L62-L70)
- **TrajectoryRecordSink._write_batch：坏记录只计数不中断，成功后更新 committed/conflicts** writer 线程的 _write_batch 遍历批次：queued_final 为真走 from_core_record，否则 from_core_snapshot；构造抛 AttributeError/TypeError/ValueError/OverflowError 时仅计数 failed 并 warning，批次继续；
  - 无记录且无帧直接 return，否则调用 _write_records_with_retry，成功后按 result.inserted/conflicts 更新计数。
- 来源：[jiuwenswarm/observability/sink.py:L472–L511](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L472-L511)
- **TrajectoryRecordSink.close：先 request_stop 再限时 join 写线程，超时返回 False 且不清 _thread** close() 先调用 request_stop()，再以 max(0.1, timeout) 秒 join 写线程（timeout 关键字参数默认 15.0）；线程不存在或已停止时返回 True 并把 _thread 置为 None；超时则记录队列内记录数并返回 False，_thread 保持不变。
- 来源：[jiuwenswarm/observability/sink.py:L302–L326](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L302-L326)
- **会话库路径按 SHA-256 摘要路由，database_files 连同 WAL 旁车一起返回** 会话数据库路径由规范化 session_id 的 SHA-256 摘要决定：database_root/digest[:2]/{digest}.sqlite3；database_files 返回该文件及其 -wal、-shm 三个路径，删除会话库须三者同删，否则残留 WAL 会被同路径后建的库重放。
- 来源：[jiuwenswarm/observability/config.py:L98–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/config.py#L98-L109)
- **AsyncTrajectoryReader._connect 依赖 aiosqlite 与 _SCHEMA_VERSION，版本不符读作不存在** _connect 依赖 aiosqlite 与 _SCHEMA_VERSION 常量：session_scoped 时先经 session_database_path 换算路径，文件不存在返回 None；以 mode=ro 打开并设 busy_timeout 与 query_only=ON 后校验 PRAGMA user_version，不等于 _SCHEMA_VERSION 即关闭连接并返回 None，旧版本库在读端表现为不存在。
- 来源：[jiuwenswarm/observability/store.py:L2336–L2357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L2336-L2357)
- **usage 与 raw 读取的既有运行时断言（未执行）** 引用现有测试源码，本次未执行：test_trajectory_session_usage.py L107 运行 AsyncTrajectoryReader(database_path).get_session_request_usage("session-1")，L111-118 断言 len(by_identity)==3、shared 的 usage total==11 且 cacheRead==5、两条 cumulative_usage input 为 15/20；
  - test_trace_store.py L512-516 断言 get_raw_record 返回字节与 final_record.raw_json 全等。
- 来源：[tests/unit_tests/observability/test_trajectory_session_usage.py:L107–L118](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/observability/test_trajectory_session_usage.py#L107-L118),
  - [tests/unit_tests/observability/test_trace_store.py:L506–L518](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/observability/test_trace_store.py#L506-L518)
- **consume 在 owner 一致且接受态用 put_nowait：满队列丢该记录换不等待** 设计推断（非作者历史意图）：
- 在 _record_owner_is_consistent 通过且 _accepting 为真的本地分支里，consume 对 maxsize=settings.queue_size 的有界记录队列调用 put_nowait；queue.Full 时仅把 dropped 与 dropped_final 各加一并记 warning 后返回，该记录不会到达 writer 线程。推断：收益是满队列时入队不等待腾位；代价是丢失这条进入该 sink 队列的记录；此路径仍在 _state_lock 内，不能等同完全无阻塞。
- 来源：[jiuwenswarm/observability/sink.py:L73–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L73-L122),
  - [jiuwenswarm/observability/sink.py:L161–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L161-L207)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/observability/feature-depth-observability.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py:L261-L289；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py:L62-L70
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py:L472-L511；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/config.py:L98-L109
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/store.py:L2336-L2357；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/observability/test_trajectory_session_usage.py:L107-L118
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/observability/test_trace_store.py:L506-L518；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py:L302-L326
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py:L73-L122；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py:L161-L207
- 源页字段（feature）：observability
- 入口（entry_points）：jiuwenswarm/observability/sink.py
- 源页字段（source_globs）：jiuwenswarm/observability/sink.py；jiuwenswarm/observability/*.py
