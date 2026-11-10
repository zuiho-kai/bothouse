---
name: ernie-image-overview
description: ERNIE-Image（main @ 5d44868e 源码派生页）：ErnieImagePipeline 单 stage diffusion 与 get_ernie_image_post_process_func、无 deploy YAML，可选 PE prompt 增强 LLM 从 checkpoint 的 pe/ 与 pe_tokenizer/ 子目录选择性拉取，AutoencoderKLFlux2 VAE、FlowMatchEulerDiscreteScheduler、CFG 由 is_distilled 旗标门控
metadata:
  scope: 只收 ERNIE-Image 的注册、源码结构要点和查阅时机；本模型目前只有这一页，共享 diffusion 实现的入口归 diffusion-overview
---
# ERNIE-Image

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页,尚无本模型的运行经验沉淀）。

### 名称与范围

- diffusion registry：`ErnieImagePipeline` →（`ernie_image`, `pipeline_ernie_image`）,post `get_ernie_image_post_process_func`。单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 源码：`pipeline_ernie_image.py`（23 KB）+ `ernie_image_transformer.py`（`ErnieImageTransformer2DModel`）。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）。

### 结构与要点

- **可选 "PE" prompt 增强 LLM**：从 checkpoint 子目录 `pe/` + `pe_tokenizer/` 加载 causal LM,经 `download_weights_from_hf_specific(model, revision, ["pe/*", "pe_tokenizer/*"])` 选择性拉取——审查下载/缓存路径改动时注意这个子目录选择性拉取模式。
- `AutoencoderKLFlux2` VAE;`FlowMatchEulerDiscreteScheduler`; `CFGParallelMixin`,CFG 由 `is_distilled` 旗标门控。另:无变体有据,树内未 pin checkpoint。

### 什么时候查这里

- 审查 ernie_image 的 PE 加载、蒸馏 CFG 门控或 VAE 改动。
- 语义验收见 [[model-validation]]（model-validation）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/ernie-image/_index.md`（InferMatrixCopilot@ecfb84d0）；title: ERNIE-Image（flow-matching DiT + 可选 prompt-enhancer）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/ernie_image/；vllm_omni/diffusion/registry.py
