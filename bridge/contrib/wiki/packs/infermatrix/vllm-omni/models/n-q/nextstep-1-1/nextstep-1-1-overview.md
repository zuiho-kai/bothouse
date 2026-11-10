---
name: nextstep-1-1-overview
description: NextStep-1.1（StepFun 自回归图像生成）目录入口：LLM 出图像 token 加 flow-matching 头、Flux VAE 解码，NextStep11Pipeline 在 diffusion registry 的登记与 _NO_CACHE_ACCELERATION 名单、StaticCache 解码循环、不走 CFGParallelMixin 的 CFG rank 划分、审查入口
metadata:
  scope: 本模型只有这一页，收名称、registry、源码文件与结构要点；没有独立规则页或架构页，未 pin checkpoint
---
# NextStep-1.1

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页,尚无本模型的运行经验沉淀）。

### 名称与范围

- StepFun NextStep-1.1：**自回归图像生成**——LLM 出图像 token + flow-matching 头,Flux VAE 解码;挂在 diffusion registry 但没有 diffusers scheduler。
- registry：`NextStep11Pipeline` →（`nextstep_1_1`, `pipeline_nextstep_1_1`）, post `get_nextstep11_post_process_func`;在 `_NO_CACHE_ACCELERATION` 名单。单 stage,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 源码：`pipeline_nextstep_1_1.py` + `modeling_nextstep*.py`（Config/Model/Llama 基座/flow 头）+ `modeling_flux_vae.py`（树内 `AutoencoderKL` 移植）。

### 结构与要点

- AR 解码循环用 transformers `StaticCache`;2D sincos 位置嵌入在 pipeline 内计算（`get_2d_sincos_pos_embed`,line 73）。
- CFG **不走 `CFGParallelMixin`**：直接用共享 CFG 群组工具 `get_cfg_group`/`get_classifier_free_guidance_rank/world_size` 跨 rank 实现——审查 CFG-parallel 共享改动时,这家族和 z_image 一样要单独确认。另:无变体有据,树内未 pin checkpoint。

### 什么时候查这里

- 审查 nextstep 的 StaticCache 解码、flow 头或 CFG rank 划分改动。
- 语义验收见 [[model-validation]]（model-validation）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/nextstep-1-1/_index.md`（InferMatrixCopilot@ecfb84d0）；title: NextStep-1.1（StepFun 自回归图像生成）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/nextstep_1_1/；vllm_omni/diffusion/registry.py
