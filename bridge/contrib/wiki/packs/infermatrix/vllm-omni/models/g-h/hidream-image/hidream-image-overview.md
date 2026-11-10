---
name: hidream-image-overview
description: HiDream-I1 入口：HiDreamImagePipeline 单 stage diffusion，四编码器文本栈（含 CLIPTextModelWithProjection、T5EncoderModel 与 LlamaForCausalLM），routed-MoE transformer（MoEGate 4 选 2）、DistributedRMSNorm，无 deploy YAML
metadata:
  scope: 只收 HiDream-I1（hidream_image）的 registry、源码文件和结构要点；HiDream-O1-Image 是另一个模型，归 hidream-o1-image-overview
---
# HiDream-I1

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页,尚无本模型的运行经验沉淀）。

### 名称与范围

- 正式名称 HiDream-I1,无别名、无变体有据,无 deploy YAML/checkpoint 映射记录。diffusion registry：`HiDreamImagePipeline` →（`hidream_image`, `pipeline_hidream_image`）,post `get_hidream_image_post_process_func`。单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 源码：`pipeline_hidream_image.py`（49 KB）+ `hidream_image_transformer.py`（43 KB）。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）。

### 结构与要点

- 四编码器文本栈,**含**（digest 点名的类）`CLIPTextModelWithProjection`、`T5EncoderModel` 与整个 `LlamaForCausalLM` 附加编码器——重编码器配置, 显存预算评审时别漏 Llama 编码器。
- transformer 是 routed-MoE feed-forward：`MoEGate` `num_routed_experts=4`/`num_activated_experts=2`（`hidream_image_transformer.py:347`）;TP 用 `DistributedRMSNorm`。
- `FlowMatchEulerDiscreteScheduler`;CFG-parallel;hub 子目录预取（`from_pretrained_with_prefetch`）。

### 什么时候查这里

- 审查 hidream 的 MoE 路由、编码器栈或预取逻辑改动。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hidream-image/_index.md`（InferMatrixCopilot@ecfb84d0）；title: HiDream-I1（MoE DiT + 四编码器文本栈）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/hidream_image/；vllm_omni/diffusion/registry.py
