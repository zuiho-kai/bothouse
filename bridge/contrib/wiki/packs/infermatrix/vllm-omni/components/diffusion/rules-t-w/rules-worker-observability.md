---
name: rules-worker-observability
description: "Diffusion 规则 DIFF-4w、DIFF-17a：initialize_model_parallel() 后按 DP、PP、SP、CFG、TP、FS、RP、EP 顺序把非 singleton 的 rank_in_group 追加到 worker 进程标题与日志前缀（PR #6722）；layerwise-offload memory A/B 在 diffusion worker 内 reset 并读取 max_memory_allocated，RPC 只返回 rank0 payload（PR #8189）"
metadata:
  scope: 只收 diffusion worker 的进程标题/日志拓扑标识与 worker 内 allocator peak 测量两条规则；parallel_state 的 FS/RP group 建立与清理（DIFF-2u）归 rules-checkpoint-loading-2
---
# Diffusion worker observability rules

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-worker-observability.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-05；updated: 2026-10-06
- 来源（sources）：PR #6722；vllm_omni/diffusion/worker/diffusion_worker.py；vllm_omni/diffusion/distributed/parallel_state.py；tests/diffusion/test_diffusion_worker_process_title.py；tests/diffusion/distributed/test_expert_parallel_layout.py；PR #8189
- 置信度（confidence）：high
- [DIFF-4w] worker title 与日志前缀必须共享已初始化的拓扑标识
  - 触发：修改 `DiffusionWorker`/`WorkerProc` 启动、model-parallel 初始化、进程标题或日志装饰。
  - 强制：early startup 保留通用 `DiffusionWorker`；`initialize_model_parallel()` 完成后、模型加载前，按 DP、PP、SP、CFG、TP、FS、RP、EP 顺序从 active group 的 `rank_in_group` 追加非 singleton 维度，并把同一名字同时交给 `set_process_title(..., prefix="vLLM-Omni")` 和 `decorate_logs()`。FS/RP 只在 HSDP 查询，RP 只在多 replica layout 查询；
    - EP 只在 expert parallel enabled 时查询。
  - 验收：覆盖初始化前 generic 名称且不读 group、singleton、省略规则、DP/PP/SP/CFG/TP、FS、multi-replica RP、conditional EP、缺少 `setproctitle` 仍装饰日志，以及 Linux `ps` 可见 title；本提交的验证边界为 unit/CPU Gloo，未提供本地 GPU 证据。^[PR #6722]
- [DIFF-17a] offload memory A/B 必须在实际 worker 内测 process-local allocator peak
  - 触发：修改layerwise-offload memory assertion、collective RPC probe或共享GPU上的memory归因。
  - 强制：model构造后在diffusion worker内synchronize并reset allocator peak，完成generate后再次 synchronize并读取max_memory_allocated。用probe+operation过滤嵌套RPC返回，缺reset ack或 snapshot必须失败；比较各次reported worker peak，仍保留offload状态和audio等价checks。
  - 验收：CPU覆盖nested/wrong probe/wrong operation/缺结果；独立inference process以相同 workload测baseline/offload，记录worker-local MB与真实启用状态，必要时反序复测filesystem cache影响。多rank全体峰值须先增加明确all-rank返回/归约，不能从单卡source外推。^[PR #8189]

## 决策与踩坑

- [DIFF-4w] 禁止：在 parallel state 可用前读 group；用 global rank 代替 topology local rank；让非 HSDP/非 EP 路径访问 FS/RP/EP；只更新 OS title 或日志之一；因 optional `setproctitle` 不可用让 worker 启动失败。
- [DIFF-17a] 禁止：用parent的device `total-free`减initial来归因model saving，混入同卡sibling jobs；将 device-global轮询或reset其他进程的allocator当有效替代。RPC当前只返回rank0 payload，取返回结果max不能提升为所有ranks的max，更不能称为total device capacity或reserved-memory峰值。
