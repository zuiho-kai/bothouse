---
name: scheduler-overview
description: vLLM-Omni Scheduler 组件总览：源码入口 vllm_omni/core/sched/（OmniARScheduler、OmniARAsyncScheduler、OmniGenerationScheduler、OmniSchedulerMixin）与 core/prefix_cache.py 的 OmniTensorPrefixCache（main @ 44d3ae10 校验行号）、测试入口 tests/core/、什么时候查 / 不放什么、目录导航表
metadata:
  scope: 只收 Scheduler 组件的入口、职责边界和到各规则页的导航；继承链、KV transfer 调度面与 prefix cache 语义归 scheduler-architecture，SCHED-1a–3a 归 scheduler-rules-1、SCHED-4a–6f 归 scheduler-rules-2，SCHED-5g / SCHED-RELEASE-1a 归 rules-release-queues、SCHED-1c / SCHED-6a2 归 rules-shared-lifecycle、SCHED-RESET / SCHED-STREAM / SCHED-NATIVE / SCHED-EXPRESS 各归对应规则页，engine 编排归 serving-overview，KVCacheTransferData 本体归 distributed-overview
---
# Scheduler（AR/生成请求调度）

## 现状

- 源码入口：`vllm_omni/core/sched/`（`omni_ar_scheduler.py`、`omni_generation_scheduler.py`、`omni_scheduler_mixin.py`、`omni_scheduling_coordinator.py`）和 `vllm_omni/core/prefix_cache.py`
- 源码校验：以上路径与下列类均已在 `main @ 44d3ae10`（upstream `main` 快照）验证存在：`OmniARScheduler`（omni_ar_scheduler.py:77）、`OmniARAsyncScheduler`（:1033）、`KVCacheTransferData`（distributed/omni_connectors/kv_transfer_manager.py:146）、`OmniGenerationScheduler`（omni_generation_scheduler.py:35）、
  - `OmniSchedulerMixin`（omni_scheduler_mixin.py:101）、`OmniTensorPrefixCache`（prefix_cache.py:33）
- 官方 draft source map：`docs/design/module/ar_runtime.md`；旧继承关系、请求流转图只在 `docs/design/module/archive/ar_module.md` 保留，须对当前代码复核。
- 测试入口：`tests/core/`
- 主要职责：AR/生成 stage 的请求调度（继承 vLLM Scheduler）、跨 stage KV transfer 的调度面、chunk/full-payload 输入等待状态机、omni tensor prefix cache

### 什么时候查这里

- 调查请求调度、waiting/running 状态转换、`WAITING_FOR_CHUNK`/`WAITING_FOR_INPUT`。
- 排查跨 stage KV transfer 的调度侧（transfer criteria、request lifecycle、kv_ready）；serialized `KVCacheTransferData` 本体属于 [[distributed-overview]]（Distributed）。
- 排查 `OmniTensorPrefixCache` 引起的跨 stage payload 截断或缓存 miss。

### 不放什么

- engine 编排（`engine/orchestrator.py`、stage pool/runtime）属于 [[serving-overview]]（Serving）。
- diffusion 的噪声调度/采样 scheduler（`vllm_omni/diffusion/sched/`）属于 [[diffusion-overview]]（Diffusion）。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 理解调度器继承链、KV transfer 与 prefix cache 语义 | [[scheduler-architecture]]（architecture） |
| 按 PR 描述直达 prefix cache、token budget、upstream 接口或 side-stream 首批源码 | [[scheduler-rules-1]]（rules / Direct 代码快速入口；源锚点 #direct-代码快速入口） |

- [[rules-shared-lifecycle]]（rules-shared-lifecycle） — SCHED-6a2 共享生命周期；SCHED-1c 核对 `OmniPrefixCacheManager` 的 same-step prefetch version 重规划。
- [[rules-prefix-reset-capability]]（Running prefix-cache reset 能力） — active request 的拓扑能力检查与拒绝边界。
- [[rules-release-queues]]（release 双 waiting queue、deferred set 与 resumable cleanup：SCHED-RELEASE-1a、SCHED-5g）。
- [[rules-stream-terminals]]（empty terminal、staged-payloadreceivegate与tail守恒）。
- [[rules-first-chunk-express]]（native sender-only admission 与 opt-in first-chunk express）。
- [[rules-async-chunk-prewarm]]（Async-chunk prewarm 规则）
- [[rules-duplex-overflow]]（Scheduler：duplex 流式 context overflow 规则）
- [[rules-prefix-cache-write]]（vllm-omni · Scheduler · Prefix-cache write-boundary rules）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/scheduler/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, components, scheduler；created: 2026-07-16；updated: 2026-10-09
- 来源（sources）：vllm_omni/core/sched/omni_ar_scheduler.py；vllm_omni/core/sched/omni_generation_scheduler.py；vllm_omni/core/sched/omni_scheduler_mixin.py；vllm_omni/core/sched/output.py；vllm_omni/core/prefix_cache.py；docs/design/module/ar_runtime.md；docs/design/module/archive/ar_module.md
