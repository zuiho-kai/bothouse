---
name: sdxl-overview
description: SDXL（main @ 5d44868e）目录入口：StableDiffusionXLPipeline 在 diffusion registry 的登记（sdxl / pipeline_sdxl）、SDXLUNet2DConditionModel、长尾清单中唯一 UNet 基且非 flow-matching 的家族（EulerDiscreteScheduler epsilon-prediction）、_dit_modules = [unet]、双 CLIP 编码器与固定 vae_scale_factor=8
metadata:
  scope: 只收 SDXL 的 registry、源码、UNet/epsilon 特例与查阅场景；MMDiT 路线归 sd3-overview，共享 diffusion 模块归 diffusion-overview
---
# SDXL

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页）。

### 名称与范围

- diffusion registry：`StableDiffusionXLPipeline` →（`sdxl`, `pipeline_sdxl`）, post `get_sdxl_image_post_process_func`。单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 源码：`pipeline_sdxl.py`（16 KB）+ `sdxl_unet.py`（`SDXLUNet2DConditionModel`,33 KB）。无变体有据,树内未 pin checkpoint。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）。

### 结构与要点

- **长尾清单调查范围内唯一 UNet 基、非 flow-matching 的家族**：`EulerDiscreteScheduler`（经典 epsilon-prediction）——涉及"所有模型都是 FlowMatch"的全局假设时,sdxl 是反例。
- `_dit_modules = ["unet"]`（`pipeline_sdxl.py:43`）——组件发现把 UNet 当 "dit" 对待;改 `_dit_modules` 语义的共享 refactor 必须带上 sdxl。
- 双 CLIP 编码器（`text_encoder`/`text_encoder_2`）; `DistributedAutoencoderKL`;post 用固定 `vae_scale_factor=8`。

### 什么时候查这里

- 审查涉及 scheduler 抽象、`_dit_modules` 语义或 epsilon/flow 假设的共享改动。
- 对照 MMDiT 路线见 [[sd3-overview]]（sd3）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/sdxl/_index.md`（InferMatrixCopilot@ecfb84d0）；title: SDXL（长尾清单中唯一 UNet/epsilon 家族）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/sdxl/；vllm_omni/diffusion/registry.py
