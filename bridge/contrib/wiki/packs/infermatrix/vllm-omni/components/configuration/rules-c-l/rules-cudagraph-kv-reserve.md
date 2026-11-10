---
name: rules-cudagraph-kv-reserve
description: 规则 VLLM-OMNI-PR7632-CUDAGRAPH-KV：启用 graph 的 stage 把 CUDA graph 估计值从自动 KV 预算扣除并 clamp 到 0，显式 kv_cache_memory_bytes 绕过，VLLM_MEMORY_PROFILER_ESTIMATE_CUDAGRAPHS=0 跳过，gpu_memory_utilization guidance 日志与 free-memory cap
metadata:
  scope: "只收 PR #7632 的 CUDA graph 显存预留与自动 KV 预算一条规则；多 stage 共卡与 kv_cache_memory_bytes pin（CONF-1a、CONF-2a）归 configuration-rules-2，环境变量 inventory 同步（VOMNI-CFG-3a）归 configuration-rules-3"
---
# 配置规则 — CUDA graph 显存预留与 KV 预算

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-cudagraph-kv-reserve.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-10-11；updated: 2026-10-11
- 来源（sources）：PR #7632
- [VLLM-OMNI-PR7632-CUDAGRAPH-KV] 启用 graph 的 stage 必须从自动 KV 预算中扣除 CUDA graph 显存
  - 触发：修改 `vllm_omni/worker/base.py`、`vllm_omni/worker/memory_utils.py` 或 `vllm_omni/engine/stage_admission.py` 中的自动 KV cache sizing、CUDA graph memory estimate、`VLLM_MEMORY_PROFILER_ESTIMATE_CUDAGRAPHS` 读取，或 `gpu_memory_utilization` 预算语义的文档。
  - 强制：CUDA-alike 平台且 graph mode 启用时，在既有 memory profile 之后调用继承的 graph profiler，把估计值从自动 KV 预算中扣除并 clamp 到 0；显式 `kv_cache_memory_bytes` pin 继续绕过该估计，`VLLM_MEMORY_PROFILER_ESTIMATE_CUDAGRAPHS=0` 跳过该 profile 并保持 graph pool 不预留。
    - 预留必须以一次性 guidance 日志说明：给出能恢复原 KV 大小的 `gpu_memory_utilization`，或当提升后的预算会超过启动时空闲显存时明确说没有任何值能恢复原大小（预算已被 `min(requested, free)` cap 时，提高 utilization 不增加预算）。新增读取的 env var 须登记 `environment_variable_inventory.py`（本例归入 INHERITED_VLLM，计数 20→21）并同步数量快照与 `docs/configuration/gpu_memory_utilization.md`。
  - 验收：tests/worker 覆盖 reserve 开关、zero clamp、capped 与 uncapped 预算、平台与 graph gate、重复 profiling、预算耗尽、显式 KV bytes、guidance 日志及继承 profiler 签名；revert clamp 或 skip 应使相应 worker-budget case 失败；`tests/config/test_environment_variables.py` 的分类数量快照与文档同步更新。 ^[PR #7632]

## 决策与踩坑

- [VLLM-OMNI-PR7632-CUDAGRAPH-KV] 禁止：让启用 graph 的 stage 把 graph pool 留给 KV cache；在预算已被 free memory cap 时仍建议提高 utilization；
  - 把 startup estimate 声称为覆盖启动后模型自捕获的 graph——`GPUARModelRunner.capture_model` 的 Talker MTP graphs 与 model `capture_auxiliary_graphs` hooks 不在估计内，使用这些 graph 的 stage 必须在 utilization 之上另留池空间；新增 env var 不登记 inventory 分类或只改数量断言（通用同步要求见 VOMNI-CFG-3a）。
