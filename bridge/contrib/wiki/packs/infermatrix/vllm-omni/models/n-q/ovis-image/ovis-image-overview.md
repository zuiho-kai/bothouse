---
name: ovis-image-overview
description: Ovis-Image（Qwen3 编码 T2I，单请求 forward）目录入口：OvisImagePipeline 的 diffusion registry 登记、pipeline_ovis_image.py 与 ovis_image_transformer.py、Qwen3Model 文本编码、supports_request_batch = False 的单请求约束及其对吞吐评审的影响、审查入口
metadata:
  scope: 本模型只有这一页，收名称、registry、源码文件与结构要点；没有独立规则页或架构页，无 deploy YAML
---
# Ovis-Image

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页,尚无本模型的运行经验沉淀）。

### 名称与范围

- 正式名称 Ovis-Image,无别名、无变体有据,无 deploy YAML/checkpoint 映射记录。diffusion registry: `OvisImagePipeline` →（`ovis_image`, `pipeline_ovis_image`）, post `get_ovis_image_post_process_func`。单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 源码：`pipeline_ovis_image.py`（27 KB）+ `ovis_image_transformer.py`（22 KB）。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）。

### 结构与要点

- 文本编码 `Qwen3Model` + `Qwen2TokenizerFast`; `FlowMatchEulerDiscreteScheduler` + `AutoencoderKL`;CFG-parallel;hub 子目录预取。
- **`supports_request_batch = False`**（`pipeline_ovis_image.py:146`）—— 一次 forward 只处理一个请求;吞吐相关评审/benchmark 设计要把这个约束当前提, 不要按 batch 家族的口径比较。

### 什么时候查这里

- 审查 ovis_image 的单请求约束、编码链或 VAE 改动。
- benchmark 口径见 [[benchmark-notes]]（benchmark/overview）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/ovis-image/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Ovis-Image（Qwen3 编码 T2I,单请求 forward）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/ovis_image/；vllm_omni/diffusion/registry.py
