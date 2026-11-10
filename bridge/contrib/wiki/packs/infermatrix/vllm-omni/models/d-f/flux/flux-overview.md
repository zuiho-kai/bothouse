---
name: flux-overview
description: FLUX.1 入口：FluxPipeline / FluxDMD2Pipeline / FluxKontextPipeline 三个 registry 变体共享 flux_transformer 与 calculate_shift，base 用 CLIP+T5、Kontext 做图像编辑、DMD2 为蒸馏少步数；Flux Kontext 进入 tiny-model alignment common suite（OMNI-CI-2d）
metadata:
  scope: 只收 FLUX.1 家族（vllm_omni/diffusion/models/flux/）的 registry、三个变体结构和查阅指引；FLUX.2 归 flux2-overview，FLUX.2-Klein 归 flux2-klein-overview
---
# FLUX.1

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页）。FLUX.2 是**两个独立家族** ——[[flux2-overview]]（flux2） 与 [[flux2-klein-overview]]（flux2-klein）。

### 名称与范围

- diffusion registry：`FluxPipeline`、`FluxDMD2Pipeline`（同模块 `pipeline_flux`）、`FluxKontextPipeline`（`pipeline_flux_kontext`）→ 家族目录 `vllm_omni/diffusion/models/flux/`;post 分别为 `get_flux_post_process_func`（base+DMD2）与 `get_flux_kontext_post_process_func`。
- 单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML,pin 上无 checkpoint↔变体映射记录。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）、`diffusion/models/t5_encoder`。

### 结构与变体

- 三个类是**变体不是别名**,共享 transformer 栈（`flux_transformer.py`,含 `FluxKontextTransformer2DModel`）与 `FluxPipelineMixin.calculate_shift`（分辨率相关 timestep-shift mu）：
  - **base**：CLIP + T5 双文本编码器,`FlowMatchEulerDiscreteScheduler`, guidance-embeds（`transformer.guidance_embeds`）。
  - **Kontext**：图像编辑（`SupportImageInput`,文本引导改图）。
  - **DMD2**：`class FluxDMD2Pipeline(DMD2PipelineMixin, FluxPipeline)`（`pipeline_flux.py:685`,FastGen DMD2 蒸馏少步数变体）。
- CFG-parallel 有 `check_cfg_parallel_validity` 对 `get_classifier_free_guidance_world_size()` 的校验。
- Flux Kontext 已从 tiny-model alignment exclusion 移除：builder 共用 Flux 的 CLIP/T5/DiT shrink，common suite 覆盖 text-to-image、image-to-image，以及 TP/CFG/CPU-offload/Cache-DiT 三组组合；原 online expansion 相应只保留单 L4 base smoke。该变化是测试资源/覆盖归属，不改变生产 pipeline；
  - 验收门禁见 [[rules-test-fixtures]]（OMNI-CI-2d；源锚点 #omni-ci-2d-diffusion-tiny-builder-必须替代资源缩减而不是能力缩减）。

### 什么时候查这里

- 审查 FLUX.1 的 shift 计算、Kontext 编辑输入或 DMD2 mixin 改动;DMD2 合同是跨家族 mixin,qwen_image 等也用——改 mixin 先扫全部使用方。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/flux/_index.md`（InferMatrixCopilot@ecfb84d0）；title: FLUX.1（base / Kontext 编辑 / DMD2 蒸馏）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-02
- 来源（sources）：PR #5823；tests/e2e/online_serving/test_flux_kontext_expansion.py；tests/model_tests/diffusion/diff_model_builders.py；tests/model_tests/diffusion/model_settings.py；tests/model_tests/diffusion/test_alignment.py；vllm_omni/diffusion/models/flux/；vllm_omni/diffusion/registry.py
