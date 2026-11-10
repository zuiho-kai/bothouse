---
name: cosmos3-overview
description: Cosmos3 diffusion family（常规 / Edge / Distilled）目录入口：实现与请求扩展路径、Distilled 须带 stochastic/SDE scheduler 合同、从输入到输出的流程、distributed VAE multi-chunk transfer 由 rank 0 组装（COSMOS-6b）、ROCm 证据范围（b3f4fbf9 单卡 MI350X gfx950 一次测量，COSMOS-3b）、session-state 实验 flag（COSMOS-2c）、什么时候查
metadata:
  scope: 只收 Cosmos3 的名称范围、变体差异、流程概述和三段证据 / 实验边界说明；可审计规则归 cosmos3-rules-1、cosmos3-rules-2，共享 diffusion 入口归 diffusion-overview
---
# Cosmos3

## 现状

### 名称与范围

- 正式 owner：Cosmos3 diffusion family；常见变体包括常规、Edge 与 Distilled。
- 模型实现：`vllm_omni/diffusion/models/cosmos3/`，包含 pipeline、常规/Edge transformer、audio tokenizer、guardrails 与 transfer。
- 请求扩展：`vllm_omni/model_extras/cosmos3.py`；注册入口在 diffusion registry。
- 共享依赖：[[diffusion-overview]]（Diffusion component）。

### 配置与 checkpoint 差异

- Distilled 变体不只是换权重：scheduler 配置必须包含 stochastic/SDE 采样合同；Edge transformer 还要维护自己的 layerwise-offload block 声明。architecture 名称、checkpoint 配置和公开支持表必须共同证明实际变体，不能从同族名称推断能力。

### 从输入到输出

- 请求中的 seed/guidance 等字段进入 Cosmos3 pipeline，pipeline 选择变体 scheduler，使用请求本地 generator 创建噪声并完成 denoise/transfer，最后交给共享 diffusion 输出路径。变体专有不变量与描述直达源码入口见 [[cosmos3-rules-1]]（rules；源锚点 #direct-代码快速入口）。新模型通用验证见 [[model-validation]]（model validation）。

### Distributed VAE multi-chunk transfer

- 当 transfer 用 distributed VAE 解码多 chunk 视频时，rank 0 是完整 video/control output 的唯一 assembler；每个非最终 chunk 只同步下一 chunk 条件所需的 decoded tail 给所有 rank。非输出 rank 保留自己的最终 decoded output 和 metadata，不拼接全量结果。该路径及其 executor gate、overlap shape 和 session-state guard 由 `COSMOS-6b` 约束；
  - 不要把一次 4×GB300 回归外推为通用 multi-GPU、parity、质量或性能支持。

### ROCm evidence scope

- ROCm recipe 的 MI350X latency/显存只来自 `b3f4fbf9` 上单卡 gfx950、Nano T2I/T2V、guardrails off 的一次 warmup + 一次测量，不是当前 pin 或通用 ROCm 保证。gfx942 只命中 platform 的 AITER capability gate，未在该 PR 实测；质量、multi-GPU 与 Cosmos3-Super 也未覆盖。引用具体数字或扩展支持矩阵时按本页审查入口中的 `COSMOS-3b` 复核。

### Session-state opt-in

- 实验 flag 可把 UND text K/V 与分支 `freqs_gen` 接入共享 manager；默认关闭，并且只在一次 request 的 denoise 生命周期内使用，不提供跨请求记忆或并发安全。具体 branch/layer 合同见本页审查入口中的 `COSMOS-2c`，共享 LRU、统计与引用存活边界见 [[session-state]]（world-model session state）。

### 什么时候查这里

- 审查 Cosmos3 Edge/Distilled scheduler、RNG、guidance、offload、distributed-VAE multi-chunk transfer 或 capability claim。
- 同一问题影响多个 diffusion 模型时返回 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion rules）。
- sampling state FP32 与 transformer dtype boundary：COSMOS-8a；沿本目录 rules 审查入口核对。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/cosmos3/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-20；updated: 2026-10-06
- 来源（sources）：PR #4657；PR #5001；PR #5634；PR #6920；docs/features/session_state_manager.md；recipes/cosmos3/Cosmos3-Nano.md；vllm_omni/diffusion/models/cosmos3/；vllm_omni/diffusion/models/cosmos3/pipeline_cosmos3.py；vllm_omni/experimental/world_models/adapters/state_cosmos3_adapter.py
  - vllm_omni/platforms/rocm/platform.py；tests/diffusion/models/cosmos3/test_cosmos3_pipeline.py
- 置信度（confidence）：high
