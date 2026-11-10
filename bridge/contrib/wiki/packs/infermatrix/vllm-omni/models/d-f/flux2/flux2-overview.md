---
name: flux2-overview
description: FLUX.2 入口：FLUX.2 diffusion pipeline 与 Mistral text encoder 接线的 owner 范围，主要路径 diffusion/models/flux2/ 与 mistral_encoder/，以及何时查 FLUX.2 规则
metadata:
  scope: 只收 FLUX.2 的 owner 范围、主要路径和查阅指引；FLUX2-1a…1d 规则正文归 flux2-rules，FLUX.1 归 flux-overview，FLUX.2-Klein 归 flux2-klein-overview
---
# FLUX.2

## 现状

### 名称与范围

- 正式 owner：FLUX.2 diffusion pipeline 与其 Mistral text encoder 接线。
- 主要路径：`vllm_omni/diffusion/models/flux2/` 与 `vllm_omni/diffusion/models/mistral_encoder/`。
- 共享量化和质量合同见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion rules）。

### 什么时候查这里

- 审查 FLUX.2 text-encoder-only FP8、transformer block 的 online FP8 prefix、component prefix、meta 初始化或 CPU offload，或 Mistral hidden-state 提取层的 checkpoint 配置。
- 描述直达源码与具体不变量见 [[flux2-rules]]（FLUX.2 rules；源锚点 #direct-代码快速入口）；通用模型适配检查见 [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model adaptation guardrails）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/flux2/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-20；updated: 2026-09-05
- 来源（sources）：PR #5136；PR #3027；PR #6390；vllm_omni/diffusion/models/flux2/；vllm_omni/diffusion/models/mistral_encoder/
- 置信度（confidence）：high
