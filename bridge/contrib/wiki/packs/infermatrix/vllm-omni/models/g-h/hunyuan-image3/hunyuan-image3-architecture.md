---
name: hunyuan-image3-architecture
description: "vLLM-Omni 核心架构速览与 HunyuanImage-3.0 代码地图：Omni 入口与 YAML 多 stage 编排、两个 registry、AR 侧与 Diffusion 侧文件、Scheduler-paged KV（PR #6563）与 Distil conditioning（PR #4048）、已迁到 deploy/hunyuan_image3_ar.yaml / _dit.yaml 的 stage 配置、hunyuan_image3 命名约定、7 条常见雷区、参考实现对照"
metadata:
  scope: 只收 vLLM-Omni 架构速览、HunyuanImage3 的文件地图、命名约定、常见雷区和 IT2I 最小命令；可审计开发规则归 hunyuan-image3-rules-1、hunyuan-image3-rules-2，官方 prompt 模板归 official-prompt-format
---
# vLLM-Omni 核心架构

## 现状

### 架构速览

- **用户入口**：`vllm_omni/entrypoints/omni.py` + `omni_base.py`
  - `Omni(model=..., stage_configs_path=...)`
  - **不要传 `mode=`，没这个参数**，路由完全由 YAML 决定
- **多 stage 编排**：通过 YAML 串起来（`vllm_omni/model_executor/stage_configs/*.yaml`）
  - 每个 stage 是 `llm`（AR 自回归）或 `diffusion`（扩散去噪）类型
  - `engine/orchestrator.py` + `engine/async_omni_engine.py` 负责跨 stage 请求路由
- **模型执行**：
  - `model_executor/models/`：LLM 风格模型（VLM / 多模态理解），用 vLLM 引擎跑
  - `diffusion/models/`：扩散风格 pipeline，用 diffusion executor 跑
- **模型注册**：
  - `model_executor/models/registry.py` → `_OMNI_MODELS` dict
  - `diffusion/registry.py` → `_DIFFUSION_MODELS` dict
  - 同一个 HF arch 名可以同时在两个 registry 里注册（AR 侧 + diffusion 侧）
- **Stage 间数据搬运**：
  - `model_executor/stage_input_processors/<model>.py` 提供 `ar2diffusion(...)` 转换函数
  - 被 YAML 里的 `custom_process_input_func` 字段引用
- **Stage config 自动发现**：
  - `config/stage_config.py` → `StageConfigFactory._ARCHITECTURE_MODELS` dict
  - 根据 HF config.json 的 `architectures` 字段自动匹配 YAML

### HunyuanImage-3.0 代码地图

#### AR 侧（model_executor）

- 主模型：`vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py`
  - `HunyuanImage3ForConditionalGeneration`：主类，含 multimodal processor、mRoPE 替换、VAE+ViT encoder
  - `HunyuanModel`：继承 vLLM 的 `HunYuanModel`，加了 QKV split 和 MoE expert mapping
  - `HunyuanImage3MultiModalProcessor`：处理 `<img>` 占位符展开
  - `HunyuanImage3RotaryEmbedding`：自定义 interleaved 2D mRoPE
- 视觉编码：`vllm_omni/model_executor/models/hunyuan_image3/siglip2.py`
- VAE：`vllm_omni/model_executor/models/hunyuan_image3/autoencoder_kl_3d.py`

#### Diffusion 侧

- Pipeline：`vllm_omni/diffusion/models/hunyuan_image3/pipeline_hunyuan_image3.py`
- DiT Transformer：`vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_transformer.py`
- Scheduler-paged KV：Scheduler 管理 logical allocation/generation；Worker 管理 physical pages、BlockTables 和 metadata。模型只交 32Q/8KV 与 `full_attn_spans`，runner 激活 request-mode prefill/denoise rows：首步覆盖整 allocation，之后只更新 prefix-offset target；dense prompt KV 在 paged forward 前清除。
  - 此范围不含 `denoise_step`、AR KV、negative CFG、Ring、AllGather 或 cross-request reuse。^[PR #6563]
- Distil conditioning：`cfg_distilled` 和 `use_meanflow` 分别追加 guidance / next-timestep-r special token；外层 pipeline 加载对应 embedding。embedded CFG 固定单 row，MeanFlow 最后一步 `r=0`；layout、step execution 与 AR-KV reuse 以 `num_special_tokens` 和 rebased scatter indices 保持同一 token contract。^[PR #4048]
- Tokenizer：`vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_tokenizer.py`
- VAE wrapper：`vllm_omni/diffusion/models/hunyuan_image3/autoencoder.py`
- MoE dispatch：`vllm_omni/diffusion/models/hunyuan_image3/hunyuan_fused_moe.py`

#### Stage 配置

- I2T（图像→文字）：`vllm_omni/model_executor/stage_configs/hunyuan_image3_i2t.yaml`
- IT2I（图像+文字→图像）：`vllm_omni/model_executor/stage_configs/hunyuan_image3_it2i.yaml`
- T2I（纯 DiT）：`vllm_omni/model_executor/stage_configs/hunyuan_image3_t2i.yaml`
- **2026-07-16 在 `main @ 238fc0a6`（此前亦在 `dev/vllm-align @ 4f2b32c` 验证，结果一致） 复核：上面三个 stage_configs YAML 已不存在**（`stage_configs/` 现只含 video/audio 模型）；当前 Hunyuan 配置位于 `vllm_omni/deploy/hunyuan_image3_ar.yaml` 和 `vllm_omni/deploy/hunyuan_image3_dit.yaml`。

#### Stage 间衔接

- `vllm_omni/model_executor/stage_input_processors/hunyuan_image3.py` → `ar2diffusion()`

#### 示例

- `examples/offline_inference/hunyuan_image3/image_to_text.py`
- `examples/offline_inference/hunyuan_image3/image_to_image.py`
- **2026-07-16 在 `main @ 238fc0a6`（此前亦在 `dev/vllm-align @ 4f2b32c` 验证，结果一致） 复核：上面两个示例已移除**，该目录现只有 `end2end.py`（+ README）。AR/DiT/衔接/tokenizer 等其余代码地图路径在同一提交全部验证存在。

### 命名约定

- **统一拼写**：`hunyuan_image3`（无下划线）
- **绝对不要**再引入 `hunyuan_image_3` 这种下划线变体
- HF arch 名：`HunyuanImage3ForCausalMM`（HF config.json 里的，不能改）
- omni 内部主类名：
  - AR 侧：`HunyuanImage3ForConditionalGeneration`
  - Diffusion 侧：`HunyuanImage3Pipeline`

### 常见雷区

1. `Omni()` 不接受 `mode=` 参数，路由通过 YAML 决定
2. AR stage YAML 里 `engine_output_type` 必须和实际产出匹配：
   - I2T 用 `text` 或不写（默认）
   - IT2I 用 `latent`
   - 搞错会让 stage 间数据搬不动
3. `HunyuanModel.load_weights` 维护一份 `unexpected_keywords` 跳过名单（line ~159）。上游模型改组件名时这里不会报错，会**静默丢权重**——加新组件时务必同步这个名单
4. mRoPE 通过 `_replace_rotary_embeddings()` 猴补丁替换层内 `rotary_emb`，加新层时要确保它能被 patch 到
5. VAE / Vision encoder 在 model_executor 侧和 diffusion 侧都有一份，**不要单边修**
6. `pipeline_hunyuan_image3.py:91-92` 硬断言 `img_proj_type=="unet"`，只支持一种投影类型
7. `autoencoder.py:26` 的 `NotImplementedError` 在 latent 维度不是 3/4/5 时触发，无上下文信息

### 参考实现对照

| 场景 | 参考标杆 | 文件 |
|------|---------|------|
| I2T blessed pattern | Qwen2.5-Omni Thinker | `model_executor/models/qwen2_5_omni/qwen2_5_omni_thinker.py` |
| IT2I 多 stage | GLM-Image | `model_executor/models/glm_image/glm_image_ar.py` + `stage_input_processors/glm_image.py` + `stage_configs/glm_image.yaml` |
| 上游源码 | HunyuanImage-3.0-Instruct | `D:/vllm-omni/hunyuan3.0_ins/` |

### 跑 IT2I 的最小命令

```bash
cd vllm-omni
python examples/offline_inference/hunyuan_image3/image_to_image.py \
    --image cherry_blossom.jpg \
    --prompt "Make the petals neon pink"
```

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-10；updated: 2026-09-05
- 来源（sources）：PR #6563；PR #4048；vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py；vllm_omni/diffusion/models/hunyuan_image3/pipeline_hunyuan_image3.py；vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_transformer.py
  - vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_tokenizer.py；vllm_omni/diffusion/models/hunyuan_image3/request_layout.py；vllm_omni/diffusion/worker/diffusion_model_runner.py；vllm_omni/model_executor/stage_input_processors/hunyuan_image3.py
