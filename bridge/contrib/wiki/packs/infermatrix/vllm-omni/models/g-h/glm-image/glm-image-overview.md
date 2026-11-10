---
name: glm-image-overview
description: GLM-Image 入口：作为 AR→DiT 图像编辑（IT2I）对齐参照家族的定位，pipeline key glm_image（AR 出 token_ids → DiT），t2i / i2i 按请求的模式差异，checkpoint 子目录化（vision_language_encoder/、processor/、transformer/、vae/）与 glm_image.yaml 的 2 卡默认和 AR 采样参数
metadata:
  scope: 只收 GLM-Image 的命名、入口路径、模式差异、checkpoint 与 deploy 配置差异；VQ prior-token 桥、编辑 KV cache 和魔数矩阵归 glm-image-architecture，GLMIMAGE-IDS-1a 归 glm-image-rules
---
# GLM-Image

## 现状

- [[glm-image-rules]]（Token-ID handoff 规则） — generated/source IDs 与辅助 hidden 的表示边界。
- 以下事实在 `main @ 5d44868e` 复核。**树内定位**（知识树自身的路由约定,非源码事实）：AR→DiT 图像编辑（i2i/IT2I）行为对齐时的参照家族——hunyuan 的 [[it2i-gap-1]]、[[it2i-gap-2]]（it2i-gap） 以它为对齐基准,定位依据见 [[reference-models]]（reference-models）。

### 名称与范围

- 正式名称 GLM-Image,无独立官方别名（checkpoint `zai-org/GLM-Image`, recipe 2×A800 验证）。代码标识:pipeline key/家族名 `glm_image`;AR 类 `GlmImageForConditionalGeneration`;diffusion **pipeline 包装类** `GlmImagePipeline`,其内的 DiT 模型类是 `GlmImageTransformer2DModel`（勿混为一谈）。
- 入口路径：AR registry `model_executor/models/registry.py` → `glm_image/glm_image_ar.py`（3216 行单文件）;diffusion registry `diffusion/registry.py` → `diffusion/models/glm_image/`（少数同时注册 **pre**-process 的家族——条件图预处理）;拓扑 `glm_image/pipeline.py`（注册于 `config/pipeline_registry.py`）;
  - 桥 `model_executor/stage_input_processors/glm_image.py`。
- pipeline key `glm_image`：AR（LLM_AR,token_ids 出）→ DiT（DIFFUSION,图像）; 桥接是 **token 流**（`need_recv_cache: False`,对照 [[bagel-overview]]（bagel） 的 KV 桥）。
- 模式差异（按请求,非独立拓扑）：t2i = AR 出小预览+大目标 token;i2i = pre-process 备条件图 → AR 导出 `prior_image` VQ ids → DiT 条件图 KV WRITE→READ。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）（CachedTransformer/cache-dit、CFG-parallel 群组）。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| VQ prior-token 桥、编辑 KV cache、魔数矩阵 | [[glm-image-architecture]]（architecture） | 数据流与 reviewer 陷阱 |

### 配置与 checkpoint 差异

- **checkpoint 子目录化**：AR 在 `vision_language_encoder/`、tokenizer 在 `processor/`、DiT 在 `transformer/`、VAE `vae/`、glyph 编码器 `text_encoder/`+`tokenizer/`——stage 配置的 `model_subdir`/`tokenizer_subdir` 与 pipeline loader 必须一致。
- `glm_image.yaml`：默认 2 卡（AR 卡 0 / DiT 卡 1）;AR 采样 `top_k 16512`、`stop_token_ids [16385]`、`max_tokens 4353`（理论上限,头注: **分辨率走 `target_h/w`,不要按请求改 max_tokens**）;带完整 NPU override 块（TP4 + 自定义 worker/scheduler + SP4 DiT）。

### 什么时候查这里

- 做 AR→DiT 桥接、图像编辑（i2i）对齐时参考其 token 桥与编辑 KV 合同;审查 MRoPE/runner 改动时注意 `precomputed_mrope_decode=True` 的隐性依赖。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/glm-image/_index.md`（InferMatrixCopilot@ecfb84d0）；title: GLM-Image（AR+DiT IT2I 精度参照）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/model_executor/models/glm_image/；vllm_omni/diffusion/models/glm_image/；vllm_omni/deploy/glm_image.yaml
