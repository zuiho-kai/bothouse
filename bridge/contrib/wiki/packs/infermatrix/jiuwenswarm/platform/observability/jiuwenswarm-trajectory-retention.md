---
name: jiuwenswarm-trajectory-retention
description: 轨迹保留、检查点与查看器投影边界：整页删除不变量与 delete_expired 事务、两层过期清扫、strict_otlp_payload 校验与 record_view_facts、TraceRecordData 类型校验与 schema user_version 处置
metadata:
  scope: 只收已存轨迹的整页保留、检查点、OTLP 投影与持久化类型校验；记录准入、队列、writer 与会话删除归 jiuwenswarm-observability
---
# 轨迹保留、检查点与查看器投影边界

## 现状

### 职责和边界

- 说明已存轨迹的整页保留、检查点、OTLP 投影与持久化类型校验；记录准入、队列、writer 和会话删除见可观测性主页面。

#### 保留、检查点与过期清扫

- 整页删除不变量：一页可删当且仅当页内每条记录 lifecycle ∈ {final, abandoned} 且 `created_at < cutoff`；每个 subject 只删最旧连续前缀；跨 subject 共享的页 key 全删或全不删（阻塞集不动点迭代）；
  - trace 级残留记录只在整 trace 全部 settled 且无剩余 turn 页时随 trace 删除（[retention.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/retention.py#L541-L542)、
  - [retention.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/retention.py#L596-L630)、
  - [retention.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/retention.py#L633-L705)）。
  - 测试：`test_retention_removes_only_the_oldest_contiguous_run_of_expired_turns`、`test_a_running_record_holds_back_its_turn_and_every_later_one`、`test_a_turn_shared_by_subagents_goes_only_when_every_subject_may_lose_it`。只有 viewer 展示的 trace 参与按 subject 组页：须有记录声明已知 agent mode 且无外 mode；
  - 未组页记录仍可能在整条 trace 已 settled、过期且无剩余 turn 页时被删除（[retention.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/retention.py#L545-L557)）。
- `delete_expired` 单事务完成：删页 → 每 subject `advance_checkpoint` 写 `trajectory_retention_checkpoints`（消息列表按内容寻址序列存储）→ 递归可达性回收无主 blobs/sequences → 实际删除记录数大于零时轮换 store_epoch 让读者重建 → commit 后同样仅在有删除时 incremental_vacuum
  - 缩文件（[store.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L1033-L1062)、
  - [store.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L1286-L1319)；`test_retention_rotates_the_epoch_and_shrinks_the_file`、`test_retention_keeps_referenced_content_and_reclaims_the_rest`）。
- 两层过期：库内保留在每个会话 writer 线程启动时与每 3600s 执行（启动时保留清理失败仅记日志不阻断；SQLite 初始化失败仍会令 writer 启动失败）；
  - 文件级由路由线程每 3600s（首个空闲时刻先扫一次）按 `mtime < now - retention_days*86400` 删除无 live writer 的会话库及 sidecar（[sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L363-L398)、
  - [sink.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L759-L813)；`test_stale_session_database_is_swept_by_mtime`、`test_sweep_skips_session_with_live_writer`、`test_router_start_runs_initial_sweep`）。

#### 查看器安全的 OTLP 校验

- `strict_otlp_payload` 拒绝 NaN/Infinity 常量与非有限浮点、要求顶层为带 `resourceSpans` 数组的 dict、嵌套 ≤256（先 C 级计数再字符串感知字节遍历）；
  - `parse_otlp_payload` 捕获 `RecursionError/TypeError/ValueError/OverflowError` 返回 None——不可解析载荷只以原始字节到达查看器、永不投影（[otlp_payload.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/otlp_payload.py#L27-L64)、
  - [otlp_payload.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/otlp_payload.py#L113-L139)）。
- `record_view_facts` 在写入时提取一次为列：`projected` 当且仅当载荷可解析且唯一 span 的 `traceId`/`spanId` 等于记录自身身份；
  - `turn_number` 需为正且 ≤ 2^53-1（按查看器 BigInt 语义读取）（[retention.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/retention.py#L322-L371)；`test_only_records_the_viewer_projects_belong_to_a_turn`）。

#### 持久化边界类型与 schema 处置

- `TraceRecordData.from_core_record`：`raw_json` 非 bytes-like 抛 `TypeError`；身份缺失或时间戳为负抛 `ValueError`；
  - 快照 lifecycle 只接受 running/provisional 并统一归一为 running，`record_revision < 1` 抛 `ValueError`（[models.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/models.py#L254-L268)、
  - [models.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/models.py#L322-L337)）。
  - 帧文本逐字保留（前导/尾随空格是内容，trim 会粘住单词），`sequence` 必须 ≥0、`session_id` 必需（[models.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/models.py#L151-L193)、
  - [models.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/models.py#L447-L458)）。
- schema `user_version` ∉ {0, 6} 时整库连同 `-wal`/`-shm` 删除重建而非迁移（`test_incompatible_schema_version_discards_database`）；
  - `initialize` 时把 lifecycle=running 的行标记 abandoned（`update_kind='recovered'`，`test_store_restart_marks_unfinished_snapshot_abandoned`）（[store.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L61-L64)、
  - [store.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L410-L452)、
  - [store.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/store.py#L1000-L1031)）。

### 怎样验证

- 源码链接固定在 f0a69728c96b5961d993449f1a901cbd2f4dac5b。聚焦单测选择器和验证范围见[[jiuwenswarm-observability]]（原模块页面；源锚点 #怎样验证）；单元契约不能替代真实服务、模型端点或跨平台集成验证。

### 相关文档

- [[jiuwenswarm-observability]]（原模块架构与入口）
- [[jiuwenswarm-runtime-session-1]]、[[jiuwenswarm-runtime-session-2]]（相邻模块）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/observability/jiuwenswarm-trajectory-retention.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/models.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/otlp_payload.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/retention.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/store.py
