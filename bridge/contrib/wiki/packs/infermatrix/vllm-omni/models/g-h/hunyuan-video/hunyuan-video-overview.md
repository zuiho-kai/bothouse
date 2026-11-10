---
name: hunyuan-video-overview
description: HunyuanVideo-1.5（T2V/I2V，meanflow 旗标蒸馏）目录入口：model_type hunyuan_video_15 与 registry 键 HunyuanVideo15Pipeline / HunyuanVideo15ImageToVideoPipeline、单 stage dit 拓扑且 I2V 不在 OMNI_PIPELINES、无 default_deploy_config_name、hunyuan_video_15.yaml 的 TP1 与 vae_use_tiling、蒸馏是旗标不是架构、VAE 强制 fp32
metadata:
  scope: 只收名称范围、registry 与拓扑、配置与 checkpoint 差异和何时查；双流块、108 偏移陷阱、65 通道输入与验证覆盖归 hunyuan-video-architecture，另一家族 HunyuanImage3 的入口归 hunyuan-image3-overview
---
# HunyuanVideo-1.5

## 现状

- 以下架构事实在 `main @ c201fd77` 复核。与 [[hunyuan-image3-overview]]（hunyuan-image3） 是**不同家族**（本家族纯 diffusion 视频,AR registry 无入口;image3 的结构见该页）。

### 名称与范围

- 正式名称 HunyuanVideo-1.5（源码未记录其他官方别名）;代码标识: model_type/pipeline key `hunyuan_video_15`,registry 架构键 `HunyuanVideo15Pipeline`（T2V）与 `HunyuanVideo15ImageToVideoPipeline`（I2V,类名 `HunyuanVideo15I2VPipeline`）。
- diffusion registry 两条目分别指向模块 `pipeline_hunyuan_video_1_5{,_i2v}`;两条 pipeline 共用 `hunyuan_video_15_transformer.HunyuanVideo15Transformer3DModel`; pre-process 仅 I2V 注册;I2V 的 post-process 是 T2V 函数的纯别名。
- 拓扑：T2V 在 `model_executor/models/hunyuan_video/pipeline.py`——单 stage 0 `dit`（DIFFUSION,无 input_sources,`final_output_type="video"`）; **I2V 不在 OMNI_PIPELINES**（走单 stage diffusion 兜底）。
  - pipeline config **无 `default_deploy_config_name`**——`hunyuan_video_15.yaml` 不会自动加载;显式传裸文件名时按 `_DEPLOY_DIR` 解析（pin 上仅 `tests/config/test_config_factory.py` 按名加载它）。
- T2V vs I2V 差异速览：I2V 加 SigLIP 图像编码器 + 图像预处理（从 `max_area` 推 H/W）+ 首帧 VAE 条件 latent/掩码;T2V 供零 image_embeds、零 cond_latents、零 mask。
- 源码：`diffusion/models/hunyuan_video/`（transformer 54 双流块、T2V/I2V 两 pipeline）;无 stage input processor。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）（CFGParallelMixin、SP `_sp_plan`、分布式/瓦片 VAE、cache-dit adapter）、`diffusion/models/t5_encoder.py`（glyph 路的共享 `T5EncoderModel`）。
- SP 不可整除时仍由 `_sp_plan` auto-pad；默认 `mask_sp_padding=False` 不把尾部零 token 交给 attention mask，以避开 varlen path，strict opt-in 与证据边界见 [[rules-sp-padding]]（SP padding rules）。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 108 偏移陷阱、65 通道输入、变体矩阵 | [[hunyuan-video-architecture]]（architecture） | 数据流与 reviewer 陷阱 |

### 配置与 checkpoint 差异

- `hunyuan_video_15.yaml`：单卡 TP1 eager;`vae_use_tiling: true`——注释明确峰值显存由整段视频一次性 VAE decode 主导,tiling 是主要显存杠杆。YAML 不 pin checkpoint。
- **蒸馏变体是旗标不是架构**：`use_meanflow`（transformer config）为真时每步额外传 `timestep_r`;本家族 pin 上**没有 DMD2 架构**（对照 [[wan2-2-overview]]（wan2-2）/[[ltx2-overview]]（ltx2）/[[flux-overview]]（flux））。
- VAE 刻意 fp32（DiT bf16）;空间压缩 16/时间压缩 4/latent 32 通道。

### 什么时候查这里

- 审查 hunyuan_video 的模板偏移、meanflow 开关或 VAE tiling 改动;I2V 相关评审记住它没有显式 pipeline key。
- 语义验收见 [[model-validation]]（model-validation）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-video/_index.md`（InferMatrixCopilot@ecfb84d0）；title: HunyuanVideo-1.5（T2V/I2V,meanflow 旗标蒸馏）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-04
- 来源（sources）：PR #4645；vllm_omni/diffusion/models/hunyuan_video/；vllm_omni/deploy/hunyuan_video_15.yaml；vllm_omni/config/pipeline_registry.py；tests/e2e/online_serving/test_hunyuan_video_15_expansion.py；PR #6349
