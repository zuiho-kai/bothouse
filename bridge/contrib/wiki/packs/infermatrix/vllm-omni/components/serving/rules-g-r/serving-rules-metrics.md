---
name: serving-rules-metrics
description: "Serving metrics 生命周期规则：SERV-2a 节流与 gauge 按 stage/replica owner 隔离、SERV-2b collector 重建只保护 vllm:omni_* family、SERV-2c stage metrics 仅首次消费累计、SERV-2f running / waiting gauge 公式（_engines_waiting_counter、_publish_request_gauges，PR #6549）、SERV-2g 去重集合挂在 ClientRequestState、VLLM-OMNI-PR8554-COLLECT-STAGE-METRICS collect_stage_metrics 门禁"
metadata:
  scope: "只收 SERV-2a、2b、2c、2f、2g 与 PR #8554 collect_stage_metrics 规则；SERV-2d 图像端点指标透传与 SERV-2e 指标发射边界归 serving-rules-3"
---
# Serving metrics 生命周期规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-metrics.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-05；updated: 2026-10-11
- 来源（sources）：PR #3576；PR #4755；PR #6549；vllm_omni/engine/async_omni_engine.py；vllm_omni/engine/orchestrator.py；vllm_omni/entrypoints/async_omni.py；vllm_omni/entrypoints/omni_base.py；tests/metrics/test_prometheus.py；PR #6561；PR #8554
- 置信度（confidence）：high
- [SERV-2a] 指标节流和 gauge 按 scheduler/stage/replica owner 隔离
  - 触发：orchestrator 聚合多 stage/replica stats，或新增全局 throttle/gauge。
  - 强制：节流状态按实际 producer owner 隔离；request 状态 cleanup 后再计算 waiting 等 gauge。
  - 验收：同一窗口内两个 replica 都能上报；单请求完成并清理后 waiting=0。^[PR #3576]
- [SERV-2b] collector 重建只保护本项目 family
  - 触发：同进程重建 engine、注册 Prometheus collectors 或调整 unregister 行为。
  - 强制：只保护需要跨实例保留的 `vllm:omni_*` family，并保留 upstream collector 的正常 unregister/cleanup。
  - 验收：同进程连续创建/销毁两次 engine，无 duplicate-timeseries 错误且 Omni family 仍可采集。^[PR #3576]
- [SERV-2c] stage metrics 只能在 result message 首次消费时累计
  - 触发：修改 `OmniBase` 的 result message 去重、`accumulate_diffusion_metrics`、`on_stage_metrics` 或重试/流式结果处理。
  - 强制：以每个请求的 `msg_id = id(result)` consumed 集合作为唯一门禁；仅在消息首次未消费时累计 diffusion metrics、处理 stage metrics，完成两项操作后再记录该消息已消费。
  - 验收：同一 result 重复处理只产生一次累计，两个 distinct result 各自产生一次；覆盖异常、重试与请求清理，确认 consumed 状态不会导致重复累计或遗留。^[PR #4755]
- [SERV-2f] pipeline gauge 必须把 engine 内 scheduler queue 从 running 移到 waiting
  - 触发：修改 `vllm_omni:num_requests_running` / `vllm_omni:num_requests_waiting`、orchestrator 的 stage/replica scheduler snapshot，或 `OmniBase` 的 request arrival、result/finalization、cleanup 发布点。
  - 强制：`AsyncOmniEngine` 与 `Orchestrator` 共享 `_engines_waiting_counter`；每次更新或移除非负的 `(stage_id, replica_id)` waiting snapshot 后，orchestrator 将其和同步进该 counter。
    - 前端只能经 `_publish_request_gauges(total)` 发布：`dispatched` 取 `_running_counter`（缺失时取 `total`），`engine_waiting` clamp 到 `[0, dispatched]`，`running = dispatched - engine_waiting`，`waiting = max(0, total - dispatched) + engine_waiting`。
    - 请求到达、stage result（包括 finalization 的 `total - 1` race 语义）和 cleanup 后都必须刷新，因此 cleanup 后的总数会覆盖尚未 pop 时的临时发布。
  - 限制：该实现求的是各 `(stage, replica)` 最新 waiting snapshot 的**和**，并不按 request ID 去重；代码和 PR #6549 的 3-dispatched/2-queued 测试只证明单一 queue 的拆分，未证明同一 pipeline request 不会同时落在多个 snapshot。因此该值是受 clamp 保护的 scheduler-queue occupancy，不应声称是精确的全局唯一请求数。
    - PR #6549 唯一 review thread 仅确认 `engines_` 名称用于区分 frontend 与 engine waiting，未处理该 cardinality 问题。
  - 验收：用真实 Prometheus scrape 覆盖 3 个已 dispatch、其中 2 个 engine scheduler waiting，精确断言 running=1、waiting=2；同时覆盖 arrival、普通/最终 stage result、cleanup、replica removal 和 snapshot 的负值/超 dispatched 值，确认既有 finalization race 语义不变。^[PR #6549]
- [SERV-2g] metrics 去重集合必须挂在请求 state 并随其释放
  - 触发：修改 `OmniBase` 的 result/message metrics 去重、`ClientRequestState`、abort 后 request state 保留，或 `_log_summary_and_cleanup`。
  - 强制：`id(msg)` / `id(result)` 去重集合必须是每个 `ClientRequestState` 上的 `consumed_metric_message_ids`，由 `_handle_output_message` / `_process_single_result` 写入；不得再维护与 request 并行的实例级 `dict[request_id, set]`。
    - abort 可按既有合同暂时保留 `request_states`，但去重集合只能活在该 state 上，并由 `generate()` 正常 cleanup / `_log_summary_and_cleanup` 与 state 一并释放。
  - 验收：生产 handler 写入 state 集合后 abort，断言实例属性无独立 request-keyed metrics map；cleanup 后 `request_states` 与任何 request-keyed map 均无该 id；同一 message 重放只累计一次。^[PR #6561]
- [VLLM-OMNI-PR8554-COLLECT-STAGE-METRICS] 逐请求 stage metrics 记账必须可门禁关闭，并保留 token/finish-reason 轻量子集与 completion 路由
  - 触发：修改 orchestrator 的 per-request stage metrics 路径（`OrchestratorAggregator` 的 stage-metric 事件合并、`StagePool.build_stage_metrics`、per-output timestamp/audio bookkeeping）、`collect_stage_metrics`/`log_stats` 门禁语义（含 CLI validation 与 orchestrator 初始化的冲突检查，以及 CLI 校验的 headless 豁免），
    - 或该 flag 的 engine 参数 plumbing。
  - 强制：`collect_stage_metrics` 默认开启以保持 legacy 行为；关闭时必须跳过 per-output timestamp/audio bookkeeping、diagnostic 计算与完整 response-level stage-metric merging——`vllm_omni/metrics/stats.py` 的 `_merge_stage_metric_event` 在该模式下于加入 `STAGE_GEN_TIME_MS` 前即返回。
    - 轻量 `StageRequestStats` 仍携带 token counts 与 finish reason 进入 response 级 stage metadata，保住 usage 记账与生成校验；completion routing 不得因关闭采集而改变（`build_stage_metrics` 仍被调用、其结果原样路由，`pipeline_timings` 为 `None`）。
    - `log_stats=True` 与 `collect_stage_metrics=False` 是矛盾配置，orchestrator 初始化（`vllm_omni/engine/orchestrator.py`）拒绝该组合；CLI validation（`vllm_omni/entrypoints/cli/serve.py`）同样拒绝，但显式豁免 headless——`--headless --log-stats --no-collect-stage-metrics` 是被接受的组合并由 `tests/entrypoints/test_serve.py` 验证。
    - Python 接口默认 `log_stats=False`、API serving 默认 `log_stats=True`（除非 `--disable-log-stats`），该默认不因新 flag 改变；flag 从 `OmniBase.__init__` 经 `OmniEngineBase`/stage-spawn plumbing 传到 orchestrator 与 stage pool。
  - 验收：覆盖关闭采集时 completion 仍调用 `build_stage_metrics` 并原样路由（断言 `pipeline_timings is None`）、completion 时 drain native cache（用 `Orchestrator(log_stats=False, collect_stage_metrics=False)` 实例化）、orchestrator 初始化拒绝矛盾配置、
    - CLI 拒绝非 headless 的矛盾配置并保留 headless 豁免的显式测试（`--headless --log-stats --no-collect-stage-metrics` 被接受）、output timestamp 不再被追踪（`does_not_track_output_timestamps` 类断言）；Qwen3 TTS 回归（`test_serving_speech.py` 的 codec limit、base nonstream/SSE completion 与 qwen3 nonstream 选择）在关闭采集下保持不变；
    - 以 `object.__new__` 构造 `AsyncOmni` 的测试 harness 必须同步设置 `collect_stage_metrics` 属性。 ^[PR #8554]

## 决策与踩坑

- [SERV-2a] 禁止：用一个全局时间戳让先上报的 replica 抑制其他 replica；在 pop/cleanup 前发布最终 gauge。
- [SERV-2b] 禁止：把 upstream unregister 整体置空，导致重复 timeseries 注册。
- [SERV-2c] 禁止：在轮询重试、重复回调或消息标记后再次累计同一 result；把同一消息误当作新的 denoising step，或绕过现有 consumed 生命周期清理。
- [SERV-2f] 禁止：把 orchestrator 已 dispatch、但仍在 stage scheduler queue 的请求报作 running；分散复制公式；让负值、过期/竞态 snapshot 或 engine waiting 大于 dispatched 产生负 gauge；在 final request 仍在 `request_states` 时丢掉既有 `total - 1` 防止 waiting 卡为 1 的语义。
- [SERV-2g] 禁止：在 `OmniBase` 上保留 request-keyed metrics 旁路 map；abort 路径留下跨请求生命周期的去重条目；让同一 message 在 abort-then-cleanup 前后被累计两次，或 cleanup 后实例上仍能按 request_id 读到残留 map。
- [VLLM-OMNI-PR8554-COLLECT-STAGE-METRICS] 禁止：在 `log_stats=False` 时仍无条件执行逐输出 stage-metric 记账与合并（Moshi/Hibiki ~12.5Hz 音频帧 cadence 下 `_merge_stage_metric_event` 曾占 orchestrator 进程约 40% 采样、最大并发实时流约减半）；关闭采集时丢弃 token counts/finish reason 子集导致 usage 统计或 TTS 生成校验改变；
  - 在 CLI 校验中静默接受非 headless 的 `log_stats=True, collect_stage_metrics=False`，或反向拒绝 headless 下的 `--log-stats --no-collect-stage-metrics` 组合；宣称 stage gen time 在关闭时仍会照常进入 response 级 stage metadata——该模式下 merge 路径不添加 `STAGE_GEN_TIME_MS`。
