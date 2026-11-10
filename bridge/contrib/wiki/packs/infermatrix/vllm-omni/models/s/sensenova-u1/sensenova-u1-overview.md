---
name: sensenova-u1-overview
description: SenseNova-U1（统一 LLM 即编码器即去噪器、无 VAE）目录入口：SenseNovaU1Pipeline 在 diffusion registry 的登记（sensenova_u1 / pipeline_sensenova_u1）、U1.5-8B-MoT 共享 pipeline 且 distilled adapter 为启动期单向融合、pipeline_sensenova_u1.py 内的 NEOVisionModel / ConvDecoder、Mixture-of-Tokenizers attention、TP 移植与 stacked_params_mapping
metadata:
  scope: 只收 SenseNova-U1 的 registry、源码、统一模型结构要点与查阅场景；SENSENOVA-1a 至 3a 归 sensenova-u1-rules，共享 RNG/graph 规则归 diffusion-rules-1、diffusion-rules-2、diffusion-rules-3
---
# SenseNova-U1

## 现状

- U1.5 的 checkpoint/fusion 和 model-local decode 合同见 [[sensenova-u1-rules]]（rules）。

### 名称与范围

- diffusion registry：`SenseNovaU1Pipeline` →（`sensenova_u1`, `pipeline_sensenova_u1`）,post `get_sensenova_u1_post_process_func`。单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- U1.5 `sensenova/SenseNova-U1.5-8B-MoT` 共享 pipeline；无 deploy YAML。它的 distilled adapter 是启动期单向融合，不是新增 pipeline/registry row。
- 源码：`pipeline_sensenova_u1.py`（66 KB,内含 `NEOVisionModel`/`TimestepEmbedder`/`ConvDecoder`/`SenseNovaU1DenoisingAdapter`）+ `sensenova_u1_transformer.py`（32 KB）+ `fused_rmsnorm_rope.py`（自定义融合核）。

### 结构与要点

- **统一模型**：同一个 Qwen3 LLM 既做文本编码（经 KV cache）又做去噪 backbone（Mixture-of-Tokenizers attention 分支）;patch 空间 flow matching; **没有独立 VAE/文本编码器**——`ConvDecoder` 直接 patch→pixel。改"文本编码器 /VAE 组件发现"共享逻辑时这是特例。
- transformer 层已 TP 移植（QKVParallelLinear/MergedColumnParallelLinear/RowParallelLinear,docstring）;权重加载走 `stacked_params_mapping`（融合 QKV/gate-up）;`CFGParallelMixin`。

### 什么时候查这里

- 审查 sensenova_u1 的统一编码/去噪路径、融合核或权重映射改动。
- 审查 U1.5 distilled LoRA、paged AR decode、GQA/RoPE/mask 时使用本页上方规则入口。
- 共享 RNG/graph 规则见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion rules）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/sensenova-u1/_index.md`（InferMatrixCopilot@ecfb84d0）；title: SenseNova-U1（统一 LLM 即编码器即去噪器,无 VAE）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-05
- 来源（sources）：PR #6516；vllm_omni/diffusion/models/sensenova_u1/；vllm_omni/diffusion/registry.py
