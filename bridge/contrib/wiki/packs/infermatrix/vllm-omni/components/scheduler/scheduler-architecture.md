---
name: scheduler-architecture
description: Scheduler 共享架构（main @ 5215e03a 复核）：OmniARScheduler / OmniGenerationScheduler / OmniSchedulerMixin 继承链、跨 stage KV transfer 的调度面、OmniSchedulingCoordinator 的 WAITING_FOR_CHUNK / WAITING_FOR_INPUT 等待、OmniTensorPrefixCache 与 requires_full_prefix_cached_hidden_states 合同、retains_state_across_chunks、与 orchestrator 的边界
metadata:
  scope: 只收调度器如何扩展 vLLM Scheduler 以及调度面 / 数据面 / 编排面的分界；失败模式与硬规则（SCHED-1a、SCHED-5a–5c 等）归 scheduler-rules-1、scheduler-rules-2，connector 数据面归 distributed-overview，runner 侧 mixin 归 model-executor-architecture，orchestrator 归 serving-architecture
---
# Scheduler 共享架构

## 现状

- 以下事实在 `main @ 5215e03a` 复核；active draft source map 是 `docs/design/module/ar_runtime.md`。继承 classDiagram 与请求流转 flowchart 仅存于 `docs/design/module/archive/ar_module.md`，属于历史叙述，仍须对当前代码复核。

### 继承链（对 vLLM 的扩展方式）

- `OmniARScheduler(OmniSchedulerMixin, VLLMScheduler)` —— `vllm_omni/core/sched/omni_ar_scheduler.py:73`。`schedule()` 调 `super().schedule()` 后，通过 `OmniNewRequestData.from_base()` 保留 base dataclass 的每个字段，再附加 `external_req_id`、`additional_information` 与 `model_intermediate_buffer`；
  - 已经是 Omni entry 的 fast path 不重建。异步变体 `OmniARAsyncScheduler(OmniARScheduler, AsyncVLLMScheduler)`（:815）。
- `OmniGenerationScheduler(OmniSchedulerMixin, VLLMScheduler)`（`omni_generation_scheduler.py:29`）—— 非 AR/单步架构（Conv/LSTM、code2wav 等）的快路径：`schedule()` 一次性为请求分配全部输入 token（预算不足回退默认调度）；`update_from_output()` 单步后直接置 `FINISHED_STOPPED` 并 `_free_request`。
- `OmniSchedulerMixin` 承载两者共享的 Omni I/O 生命周期：初始化 chunk/full-payload 协调状态、消费 pending input、恢复临时停放队列、无损重包 `NewRequestData`、清理完成请求，以及汇总 KV stats/events、finished sets 和 scheduler stats。AR 与 generation scheduler 仍各自拥有调度策略和 finished-ID 语义；AR 的 synthetic-abort output 是显式本地策略，不能被共享 helper 隐式扩散。

### 跨 stage KV transfer（调度面）

- AR scheduler 的 transfer criteria 与 request lifecycle 决定“何时可发/何时已就绪”；serialized `KVCacheTransferData` 位于 `distributed/omni_connectors/kv_transfer_manager.py:146`，实际搬运由 [[distributed-overview]]（Distributed 组件）的 connector/KV-transfer 数据面执行。
  - 真实案例（只链接不复制）：[[2026-05-13-kv-reuse-orchestrator-1]]、[[2026-05-13-kv-reuse-orchestrator-2]]（HunyuanImage3 KV reuse 事故） 中 `omni_ar_scheduler.py` 的 kv_ready 发射与 `_mark_request_for_kv_transfer` 是根因链的一环。

### chunk / full-payload 输入等待

- `OmniSchedulingCoordinator`（`omni_scheduling_coordinator.py`）管理 `WAITING_FOR_CHUNK` / `WAITING_FOR_INPUT` 状态转换，判定依据是 `OmniConnectorOutput` 的就绪信号——协调器**不直接**调用 connector 的 put/get（数据面在 runner 的 `OmniConnectorModelRunnerMixin`，见 [[model-executor-architecture]]（Model Executor））。
  - 模块 docstring 声明它取代了旧 `OmniChunkTransferAdapter` 的调度侧职责。

### Omni tensor prefix cache

- `OmniTensorPrefixCache`（`core/prefix_cache.py:33`，含 `_PendingAsyncWrite` 异步写）缓存逐 token 张量（如 thinker 的 `hidden_states.layer_N`），prefix 命中时只执行后缀 token，前缀行从缓存重建后拼入跨 stage payload。
  - 消费端合同：`vllm_omni/worker/gpu_ar_model_runner.py:603` 读取模型的 `requires_full_prefix_cached_hidden_states`（默认 True；`qwen3_tts_talker.py:311`、`higgs_audio_v3_talker.py:236` 显式声明 False）。该机制的失败模式与硬规则见 [[scheduler-rules-1]]、[[scheduler-rules-2]]（rules） 的 `SCHED-1a`。
- 在目标版本，`OmniGenerationScheduler` 还区分 `retains_state_across_chunks`：等待 connector chunk 的 request 仍占用 model-runner capacity，并在 full-payload chunk 到达后重新进入可调度队列。AR scheduler 在消费 sampled-token logprobs 前完成 request-local 合同校验；
  - stage-0-final 的普通请求可以跳过下游 KV，但 companion 等显式带 `omni_force_kv_transfer` 的请求不能走该 shortcut。这些跨层语义分别见 [[scheduler-rules-1]]、[[scheduler-rules-2]]（scheduler rules） 的 `SCHED-5a`–`SCHED-5c`。

### 与 orchestrator 的边界

- 调度器只负责单 stage 内的请求生命周期与跨 stage 载荷的调度面；逻辑请求在 stage 间的推进、路由与转发属于 `engine/orchestrator.py`（[[serving-architecture]]（Serving））。诊断跨 stage 问题时先分清 "调度面（这里）/数据面（distributed）/编排面（serving）"再下钻。
- 源码会变化，具体类名和行号在改代码前必须以目标仓库当前版本为准。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/scheduler/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, components, scheduler；created: 2026-07-16；updated: 2026-09-02
- 来源（sources）：docs/design/module/ar_runtime.md；docs/design/module/archive/ar_module.md；vllm_omni/core/sched/omni_ar_scheduler.py；vllm_omni/core/sched/omni_generation_scheduler.py；vllm_omni/core/sched/omni_scheduler_mixin.py；vllm_omni/core/sched/output.py
  - vllm_omni/core/sched/omni_scheduling_coordinator.py；vllm_omni/core/prefix_cache.py；vllm_omni/worker/gpu_ar_model_runner.py
