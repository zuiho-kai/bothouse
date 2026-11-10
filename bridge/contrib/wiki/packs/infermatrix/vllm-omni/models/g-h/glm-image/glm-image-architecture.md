---
name: glm-image-architecture
description: GLM-Image 架构：glm_image_ar.py 的视觉编码器 + VQ-VAE 与 precomputed_mrope_decode 依赖，DiT 侧 GlmImageKVCache（WRITE/READ/SKIP）与 glyph 路径，魔数矩阵（EOS 16385、vision 词表 16512、AR 32× vs DiT 16×、max_tokens 4353），ar2diffusion 的 2× 最近邻上采样，i2i 四步流程与测试入口
metadata:
  scope: 只收 GLM-Image 的模块边界、checkpoint 子目录与魔数、输入到输出流程和验证入口；命名与模式速览归 glm-image-overview，token-ID handoff 规则归 glm-image-rules
---
# GLM-Image 架构

## 现状

- 事实在 `main @ 5d44868e` 复核;行号随源码漂移,改代码前以当前版本为准。入口/模式速览见 [[glm-image-overview]]（GLM-Image index）;KV 桥对照见 [[bagel-architecture]]（bagel）。

### 模型专有部分与共享模块的边界

- 专有 AR 侧：`glm_image_ar.py` 一文件承载视觉编码器 + **VQ-VAE**（把视觉特征量化成离散图像 token）+ 文本栈;LM head 只到 `vision_vocab_size`（16512）而非全词表;`SupportsMRoPE` 且 **`precomputed_mrope_decode=True`**——decode 期用 AR 侧预计算的 2D 网格位置,runner 的 MRoPE 改动会静默破坏本家族。
- 专有 DiT 侧：`glm_image_transformer.py`（含图像编辑专用 `GlmImageKVCache`：WRITE/READ/SKIP 三态,DiT attention 内拼接条件图 K/V—— 与 vLLM paged KV、Bagel 的 `NaiveCache` 都不同）; `pipeline_glm_image.py`（glyph 路径:prompt 引号内子串走 ByT5+T5 编码, 文字渲染条件）。
- 共享：`FlowMatchEulerDiscreteScheduler`、`CachedTransformer`（cache-dit/TeaCache 可用）、CFG-parallel 群组、[[diffusion-overview]]（Diffusion 组件）。

### 配置、checkpoint 和兼容范围

- 单 pipeline key,t2i / i2i 是**按请求的模式**不是独立拓扑。
- checkpoint 子目录归属：AR 权重 `vision_language_encoder/`、tokenizer `processor/`（stage 配置 `model_subdir`/`tokenizer_subdir`）;DiT `transformer/`、VAE `vae/`、glyph 编码器 `text_encoder/`+`tokenizer/`（pipeline loader 子目录）——两处必须保持一致。
- **魔数矩阵**（改任何一个要 deploy YAML + `ar2diffusion` + AR 模型联动）：EOS 16385;vision 词表 16512;AR 网格 32× vs DiT 16×;patch 2; `max_tokens 4353`。
- TP 约束有专用校验 `validate_glm_image_tp_constraints`;SP 有测试覆盖。

### 从输入到输出的主要流程

1. （i2i）pre-process：条件图对齐到 `vae_scale_factor×patch` 倍数,存 `additional_information`。
2. AR 前传：i2i 时条件图经视觉编码器+VQ-VAE 出 `prior_image` ids（经实例态 `_prior_token_cache` 从 `embed_multimodal` 递给 `forward`—— 并发/warmup 评审注意）;生成 token 流 = 小预览 + 大目标（t2i）或仅大目标（i2i）。
3. `stage_input_processors/glm_image.py::ar2diffusion`：剥 EOS 16385、按 32× 网格解析、**2× 最近邻上采样到 16× 网格**;解析失败**宁跳不降质**（显式拒绝低质量 fallback）。
4. DiT：仅 i2i 有条件图 KV（先 WRITE 后 READ;t2i 无此 cache）;CFG 用 prior-token drop 掩码双前传,CFG-parallel 时 rank0 正/rank1 负 + all_gather/broadcast;去噪 → VAE → 图像。

### 怎样验证功能、精度和性能

- 以下为**功能/量化/并行面**的测试入口;pin 上没有专门的精度基线或性能 gate 证据,精度/性能结论需另行实测。
- 单元：`tests/model_executor/models/glm_image/test_glm_image_ar.py`、`tests/model_executor/stage_input_processors/test_glm_image.py`（token 网格解析）;DiT: `tests/diffusion/models/glm_image/test_glm_image_quantization.py`、`tests/diffusion/models/glm_image/test_glm_image_sp.py`。
- e2e：`tests/e2e/online_serving/test_glm_image_expansion.py`、`tests/e2e/offline_inference/test_glm_image_autoround_w4a16_expansion.py`（W4A16）;recipe `recipes/GLM/GLM-Image.md`。
- 已知未决：`diffusers_class_name` 与 stage-1 `model_arch` 双写,引擎实际以哪个实例化未 live 追清;i2i 的 t2i-布局 fallback 触发条件不明。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/glm-image/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/model_executor/models/glm_image/glm_image_ar.py；vllm_omni/diffusion/models/glm_image/pipeline_glm_image.py；vllm_omni/diffusion/models/glm_image/glm_image_transformer.py；vllm_omni/model_executor/stage_input_processors/glm_image.py
  - vllm_omni/model_executor/models/glm_image/pipeline.py；vllm_omni/deploy/glm_image.yaml
