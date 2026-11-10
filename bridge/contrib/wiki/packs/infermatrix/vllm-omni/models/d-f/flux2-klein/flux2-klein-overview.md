---
name: flux2-klein-overview
description: FLUX.2-Klein 入口：Flux2KleinPipeline 独立家族目录 flux2_klein，文本编码用 Qwen3ForCausalLM + Qwen2TokenizerFast、AutoencoderKLFlux2 VAE，蒸馏是构造期 is_distilled 旗标，无 deploy YAML；final-layout HWR 相关改动的查阅指引
metadata:
  scope: 只收 FLUX.2-Klein 的 registry、结构要点和查阅指引；FLUXK-1a 归 flux2-klein-rules，FLUX.2 归 flux2-overview，FLUX.1 归 flux-overview
---
# FLUX.2-Klein

## 现状

- 以下事实在 `main @ da4a08b6` 复核；运行证据与支持范围以具体规则为准。

### 名称与范围

- diffusion registry：`Flux2KleinPipeline` →（`flux2_klein`, `pipeline_flux2_klein`）,post `get_flux2_klein_post_process_func`——**独立于 flux2 家族目录**,与 [[flux2-overview]]（flux2）、[[flux-overview]]（flux） 互为姊妹家族。
- 单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 源码：`pipeline_flux2_klein.py`（46 KB）+ `flux2_klein_transformer.py`（41 KB）。

### 结构与要点

- 文本编码用 `Qwen3ForCausalLM` + `Qwen2TokenizerFast`（不是 CLIP/T5）; `AutoencoderKLFlux2` VAE,自定义 `Flux2ImageProcessor(VaeImageProcessor)`（`pipeline_flux2_klein.py:55`）。
- 类混入 `CFGParallelMixin, SupportImageInput`;**单架构、无别名有据**—— 蒸馏行为是构造期 `is_distilled` 旗标（不是另一个架构）;无 deploy YAML/checkpoint 映射记录;img2img latents 走 diffusers `retrieve_latents`。

### 什么时候查这里

- 审查 flux2_klein 的 Qwen3-LLM 编码链、图像输入或蒸馏旗标改动;文本编码方案与 flux2 家族不同,勿混（见该页）。
- 审查 final-layout Host Weight Runtime (HWR) restore、BF16 checkpoint 与 no-AllGather DLO 的组合。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| FLUX.2-klein final-layout HWR contract、packed QKV state、eligible/supported boundary | [[flux2-klein-rules]]（Klein rules） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/flux2-klein/_index.md`（InferMatrixCopilot@ecfb84d0）；title: FLUX.2-Klein（Qwen3 编码的 T2I/I2I）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-04
- 来源（sources）：PR #6651；vllm_omni/diffusion/models/flux2_klein/；vllm_omni/diffusion/registry.py
