---
name: observability-knowledge
description: JiuwenSwarm 可观测性知识条目：first-wins 冲突记录与流帧追加、会话分库数据流、trajectory_ui 配置块解析、存储行为的既有测试入口、轨迹消费入口与延迟载荷校验
metadata:
  scope: 只收 observability 的五条知识条目（features、architecture、configuration、validation、api）；主架构叙述归 jiuwenswarm-observability，保留与投影归 jiuwenswarm-trajectory-retention
---
# JiuwenSwarm 可观测性：轨迹存储路由、有界写入与每会话 SQLite（jiuwenswarm/observability）

## 现状

- **特性：first-wins 冲突记录、按 span 的流帧追加与终态丢弃**
- 最终记录按 (trace_id, span_id) 唯一插入；同身份不同 raw_sha256 不覆盖旧行，而是写入 otlp_record_conflicts 表并在统计中计 conflicts——首个原始记录被保留。模型流帧按 span（trajectory_frame_spans 注册后以 span_ref 引用）追加存储、从不合并；默认 discard_final_span_frames=true 时，span 终态记录提交后其帧随即在同一事务中删除，晚到的帧也被丢弃（其 span 已有完整输出），置 false 则帧保留整个 turn 页面以支持逐帧回放。
- Sources / 来源：[jiuwenswarm/observability/store.py:L549–L601](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L549-L601),
  - [jiuwenswarm/observability/store.py:L737–L788](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L737-L788),
  - [jiuwenswarm/observability/config.py:L27–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/config.py#L27-L32)
- **数据流与会话分库**
- 控制流为两级：TrajectorySessionSinkRouter 的 consume/consume_snapshot/consume_stream_frame 只做常数开销入队，路由线程按 session_id 懒创建每会话一个 TrajectoryRecordSink，并用 replace 把 database_path 换成该会话的独立库；sink 内部用有界双队列（记录与流帧分开）加单条 writer 线程批量提交 SQLite。
  - 会话库路径由 session_database_path 派生：取 session_id 的 SHA-256 hexdigest 前 2 个十六进制字符做一级目录、完整 digest 作文件名，路径不含任何用户可控组件；sweep_stale_databases 再按文件 mtime 超过 retention_days 清理无活跃 writer 的库。
- Sources / 来源：[jiuwenswarm/observability/sink.py:L640–L650](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L640-L650),
  - [jiuwenswarm/observability/sink.py:L905–L919](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L905-L919),
  - [jiuwenswarm/observability/config.py:L82–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/config.py#L82-L99),
  - [jiuwenswarm/observability/sink.py:L759–L794](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L759-L794)
- **trajectory_ui 配置块与解析规则**
- load_trajectory_store_settings 读取配置映射的 trajectory_ui 块（缺省取 get_config()），不改写用户配置：enabled 缺省 False（旧配置无此块即整体禁用），queue_size 4096、batch_size 64、flush_interval_ms 500、retention_days 7、detail_max_bytes 4MiB（解析最小 64KiB）、discard_final_span_frames 缺省 True。
  - db_path 为空时落到 workspace/.trace/sessions，相对路径则相对 workspace，绝对路径原样使用。数值解析 _positive_int 只捕获 TypeError/ValueError：无法转换或低于最小值时回退默认值，不承诺捕获其他异常。
- Sources / 来源：[jiuwenswarm/observability/config.py:L16–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/config.py#L16-L32),
  - [jiuwenswarm/observability/config.py:L126–L154](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/config.py#L126-L154),
  - [jiuwenswarm/observability/config.py:L64–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/config.py#L64-L69),
  - [jiuwenswarm/observability/config.py:L72–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/config.py#L72-L79)
- **存储行为与运行时装配的既有测试入口**
- tests/unit_tests/observability/test_trace_store.py 直接驱动 TrajectoryStore.write_records：断言终态记录提交时清除其 span 的既有帧、discard_final_span_frames=False 时帧被保留（含迟到帧）、重放同字节不计数而内容不同的重放记为 1 个冲突且原始字节原样取回（L289–L311、L355–L373、L425–L449）。
  - tests/unit_tests/agentserver/test_trajectory_runtime_wiring.py 通过 monkeypatch 断言 trajectory_ui.enabled 会让 agent 与 team 两条路径各调用一次 sync_trajectory_runtime 并携带解析后的 enabled/database_path，禁用时仍同步停用而不释放 provider（L214–L246、L379–L412）。所列测试片段仅为定位入口，本页未执行它们。
- Sources / 来源：[tests/unit_tests/observability/test_trace_store.py:L289–L311](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/observability/test_trace_store.py#L289-L311),
  - [tests/unit_tests/observability/test_trace_store.py:L425–L449](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/observability/test_trace_store.py#L425-L449),
  - [tests/unit_tests/agentserver/test_trajectory_runtime_wiring.py:L214–L246](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_trajectory_runtime_wiring.py#L214-L246),
  - [tests/unit_tests/agentserver/test_trajectory_runtime_wiring.py:L379–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_trajectory_runtime_wiring.py#L379-L412)
- **轨迹消费入口与延迟载荷校验**
- TrajectorySessionSinkRouter 对外提供 consume / consume_snapshot / consume_stream_frame 三个常量开销入口，各自把记录以 final/snapshot/frame 类型做一次有界入队；路由线程再按会话转发给每会话的 TrajectoryRecordSink。
  - 载荷类型校验发生在写入线程：记录经 TraceRecordData.from_core_record / from_core_snapshot 转换，流帧经 StreamFrameData.from_core_frame 转换，坏记录只计入 failed 计数而不使整批失败。
- Sources / 来源：[jiuwenswarm/observability/sink.py:L640–L650](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L640-L650),
  - [jiuwenswarm/observability/sink.py:L479–L494](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L479-L494),
  - [jiuwenswarm/observability/sink.py:L821–L866](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L821-L866)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/observability/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/store.py:L549-L601；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/store.py:L737-L788
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/config.py:L27-L32；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py:L640-L650
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py:L905-L919；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/config.py:L82-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py:L759-L794；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/config.py:L16-L32
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/config.py:L126-L154；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/config.py:L64-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/config.py:L72-L79；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/observability/test_trace_store.py:L289-L311
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/observability/test_trace_store.py:L425-L449；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_trajectory_runtime_wiring.py:L214-L246
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_trajectory_runtime_wiring.py:L379-L412；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py:L479-L494
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py:L821-L866
