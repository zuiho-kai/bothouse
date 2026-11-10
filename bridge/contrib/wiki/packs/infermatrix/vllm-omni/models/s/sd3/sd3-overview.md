---
name: sd3-overview
description: Stable Diffusion 3（main @ 5d44868e）目录入口：StableDiffusion3Pipeline 在 diffusion registry 的登记（sd3 / pipeline_sd3）、sd3_transformer.py 的 SD3Transformer2DModel、2× CLIPTextModelWithProjection + T5EncoderModel 三文本编码器、FlowMatchEulerDiscreteScheduler、DistributedAutoencoderKL、与 sdxl 的 UNet/epsilon 路线对照
metadata:
  scope: 只收 SD3 的 registry、源码、编码器栈与分布式 VAE 要点及查阅场景；UNet/epsilon 路线归 sdxl-overview，共享 diffusion 模块归 diffusion-overview
---
# Stable Diffusion 3

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页）。

### 名称与范围

- diffusion registry：`StableDiffusion3Pipeline` →（`sd3`, `pipeline_sd3`）, post `get_sd3_image_post_process_func`。单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 源码：`pipeline_sd3.py`（33 KB）+ `sd3_transformer.py`（`SD3Transformer2DModel`）。无变体有据,无 deploy YAML,树内未 pin checkpoint。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）。

### 结构与要点

- 编码器栈：2× `CLIPTextModelWithProjection` + `T5EncoderModel`; `FlowMatchEulerDiscreteScheduler`;`CFGParallelMixin`。
- `DistributedAutoencoderKL`（可 patch-parallel 的共享 VAE 实现）;批量输出用 `split_diffusion_output_by_request` 拆分。

### 什么时候查这里

- 审查 sd3 的三编码器栈或分布式 VAE 改动;与 sdxl 的 UNet/epsilon 路线对照见 [[sdxl-overview]]（sdxl）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/sd3/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Stable Diffusion 3（MMDiT,三文本编码器）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/sd3/；vllm_omni/diffusion/registry.py
