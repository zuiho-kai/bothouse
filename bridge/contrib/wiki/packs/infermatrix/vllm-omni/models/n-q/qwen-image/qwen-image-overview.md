---
name: qwen-image-overview
description: Qwen-Image（base / Edit / Edit-Plus / Layered / DMD2 五变体，main @ 5d44868e）目录入口：五个 pipeline 到模块的映射、Layered 有 pre 无 post 绑定的未追清点、Qwen2_5_VL prompt 编码、分布式 VAE DistributedAutoencoderKLQwenImage、QwenImageCFGParallelMixin 与 DMD2PipelineMixin、distilled LoRA 只接 QwenImagePipeline 与 DMD2
metadata:
  scope: 只收 Qwen-Image 家族的变体映射、结构要点与目录路由；QWENIMG-1a 至 1d 及 VLLM-OMNI-PR 规则归 qwen-image-rules，QWENIMG-1e 归 rules-qwen-image-21；同厂牌 AR 侧家族归 qwen-omni-overview
---
# Qwen-Image

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页,尚无本模型的运行经验沉淀）。同厂牌 AR 侧家族另见 [[qwen-omni-overview]]（qwen-omni）。

### 名称与范围

- 尾部最宽家族,5 个 pipeline（变体）共享一套 transformer/VAE,模块映射: `QwenImagePipeline`→`pipeline_qwen_image`; `QwenImageEditPipeline`→`pipeline_qwen_image_edit`; `QwenImageEditPlusPipeline`→`pipeline_qwen_image_edit_plus`; `QwenImageLayeredPipeline`→`pipeline_qwen_image_layered`;
  - `QwenImageDMD2Pipeline`→`pipeline_qwen_image`（与 base 同模块）→ 家族目录 `vllm_omni/diffusion/models/qwen_image/`（9 文件）;pin 上无 checkpoint↔变体映射记录。
- pre/post 绑定不对称：pre 有 edit/edit-plus/layered;post 有 base/edit/edit-plus（DMD2 复用 base）——**Layered 有 pre 无 post 绑定**, layered 输出后处理是否在 pipeline 内完成未在 pin 上追清,评审 layered 输出路径改动时先追这条线。
- 单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。

### 结构与要点

- `Qwen2_5_VLForConditionalGeneration` prompt 编码;**分布式 VAE** `DistributedAutoencoderKLQwenImage`（`diffusion/distributed/autoencoders/`, 少数带 VAE patch-parallel 的家族）;树内 `autoencoder_kl_qwenimage.py`（42 KB）。
- 家族专属 `cfg_parallel.py`（`QwenImageCFGParallelMixin`,四个非 DMD2 pipeline 共用）;DMD2 经 `DMD2PipelineMixin`（`pipeline_qwen_image.py:1097`）;prompt 长度校验 `validate_prompt_sequence_lengths`。
- distilled LoRA 当前由 `QwenImagePipeline` 及继承它的 DMD2 变体接入 `QwenImageLoraLoaderMixin`；支持 key converter、packed parameter 与 Diffusers non-unit alpha/rank 缩放。共享 load/unload 门禁见 [[rules-lora-1]]（DIFF-2m；源锚点 #diff-2m-distilled-delta-必须按真实-parameter-布局可逆合并）；
  - Edit/EditPlus/Layered 未接入，converter map 有名称也不代表 pipeline 拥有 loader mixin。

### 什么时候查这里

- 审查 qwen_image 任一变体的 CFG-parallel、分布式 VAE 或 DMD2 改动——五变体共栈,单变体改动先扫其余四个;共享 mixin 见 [[diffusion-overview]]（Diffusion 组件）。
- 审查 accuracy、regional compile、FlashAttention 确定性或 Edit `txt_seq_lens` 时见
  - [[qwen-image-rules]]（Qwen-Image 规则）。 新增核对：QWENIMG-1d。
- [[rules-qwen-image-21]]（Qwen-Image-2.1 能力与 FP8 证据边界）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen-image/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Qwen-Image（base/Edit/Edit-Plus/Layered/DMD2 五变体）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-22
- 来源（sources）：PR #2783；vllm_omni/diffusion/lora/loader.py；vllm_omni/diffusion/models/qwen_image/；vllm_omni/diffusion/registry.py；tests/diffusion/lora/test_loader.py
