---
name: z-image-overview
description: Z-Image（LLM 编码 flow-matching T2I）源码派生入口：ZImagePipeline 注册、单 stage diffusion、text_encoder 按 causal LM 加载、无 CFGParallelMixin，及何时查这里
metadata:
  scope: 只收 Z-Image 的名称与范围、结构要点和查阅场景；TeaCache 校准与在线服务合同归 z-image-rules
---
# Z-Image

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页,尚无本模型的运行经验沉淀）。

### 名称与范围

- diffusion registry：`ZImagePipeline` →（`z_image`, `pipeline_z_image`）; post 绑定到**通用命名的 `get_post_process_func`**——全清单唯一没有模型前缀 post 函数名的家族,grep post 函数时容易漏。
- 单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 源码：`pipeline_z_image.py`（31 KB）+ `z_image_transformer.py`（39 KB,`ZImageTransformer2DModel`）。无变体有据,树内未 pin checkpoint。

### 结构与要点

- 文本编码器从 checkpoint 的 `text_encoder/` 子目录按 causal LM 加载（`AutoConfig`/`AutoModelForCausalLM` 经 `create_transformers_model`, `pipeline_z_image.py` ~182–216）。
- `FlowMatchEulerDiscreteScheduler`;`DistributedAutoencoderKL`; **类上没有 `CFGParallelMixin`**（`pipeline_z_image.py:164`）——CFG-parallel 共享改动时与 [[nextstep-1-1-overview]]（nextstep-1-1） 一样按特例处理。

### 什么时候查这里

- 审查 z_image 的编码器加载或 CFG 路径改动。
- 语义验收见 [[model-validation]]（model-validation）。
- [[z-image-rules]]（Z-Image TeaCache 校准合同）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/z-image/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Z-Image（LLM 编码 flow-matching T2I）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/z_image/；vllm_omni/diffusion/registry.py
