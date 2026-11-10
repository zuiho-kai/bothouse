---
name: hunyuan-video-architecture
description: "HunyuanVideo-1.5 架构：HunyuanVideo15Transformer3DModel 54 个双流块与 meanflow timestep_r、MLLM 加 ByT5 glyph 双文本编码器、强制 fp32 的分布式 VAE、crop_start=108 字节级模板陷阱、DiT 输入 65 通道（latents 32 + cond_latents 32 + mask 1）、T2V / I2V 条件准备与去噪流程、PR #6349 的 e2e 与 DFX 覆盖（无基线阈值）"
metadata:
  scope: 只收专有部分与共享模块边界、配置与兼容、输入到输出流程和验证覆盖；名称、registry 拓扑与 yaml 差异归 hunyuan-video-overview
---
# HunyuanVideo-1.5 架构

## 现状

- 事实在 `main @ c201fd77` 复核;入口/变体速览见 [[hunyuan-video-overview]]（index）。

### 模型专有部分与共享模块的边界

- 专有 transformer：`HunyuanVideo15Transformer3DModel`——54 个双流块 + token refiner + ByT5 文本投影 + 图像投影 + meanflow 能力的时间嵌入（`timestep_r`）;并行标记齐全（`_sp_plan` 分 rope/收 proj_out、`packed_modules_mapping`、`_cache_dit_adapter_config` `has_separate_cfg=True`、layerwise offload/HSDP 条件）。
- 双文本编码器：MLLM 路（Qwen2.5-VL 文本塔,取倒数第 3 层 hidden）+ glyph 路（ByT5 只编码 prompt 引号内子串,无引号时喂 `(1,256,d)` 零张量）。
- VAE：`DistributedAutoencoderKLHunyuanVideo15`,**强制 fp32**; `flow_shift` 覆盖靠直写 `scheduler._shift`（属性无 setter）。
- 共享：[[diffusion-overview]]（Diffusion 组件）的 CFG-parallel（rank0 正/rank1 负 + all_gather）、SP 中央应用、瓦片/切片 VAE 布线。

### 配置、checkpoint 和兼容范围

- **字节级模板陷阱**：MLLM 编码的 `crop_start=108` 依赖系统消息 tokenize 后长度——**系统消息空白必须与 diffusers 字节一致**（源注释明示;偏离的运行期后果未在 pin 上实测）。
- DiT 输入 65 通道 = `cat([latents 32, cond_latents 32, mask 1])`; transformer 用 image_embeds 全零检测 T2V 模式。
- 权重加载混合两轨：transformer/text_encoder_2 走 ComponentSource + AutoWeightsLoader;其余 `from_pretrained`（带子目录预取,避 transformers v5 多 worker 缓存竞态）。

### 从输入到输出的主要流程

1. 条件准备分支：T2V **无注册 pre-process**,直接构造全零 `image_embeds`/`cond_latents`/`mask`（transformer 靠 image_embeds 全零检测 T2V 模式）;I2V pre-process 从 `max_area=480×832`、16 整除推 H/W, SigLIP 编码输入图 → `image_embeds`,首帧 VAE argmax latent×scale 进 `cond_latents`,mask 帧 0 置 1、后续帧零。
2. 文本双路编码;线性 sigma `np.linspace(1.0, 0.0, steps+1)[:-1]`（去掉末端零）交给 scheduler 内部做 shift。
3. 去噪循环:CFG 经 `predict_noise_maybe_with_cfg`;meanflow 时每步传 `timestep_r`（末步 0.0）;RNG 走 per-request generator + `randn_tensor`（generator 列表长度必须等于 batch）。
4. `empty_cache()` 后先 `latents / vae.config.scaling_factor` 再 `vae.decode`（OOM 缓解与 wan2_2 同款）→ `VideoProcessor(vae_scale_factor=16)` → 展平成 PIL 帧列表。

### 怎样验证功能、精度和性能

- 功能覆盖分层：基本单 H100 CPU-offload T2V online-serving case 在 ready/merge 的 `core_model` 与 `advanced_model` lane 运行；CacheDiT + layerwise CPU-offload（1 卡）和 CacheDiT + TP=2 + VAE patch parallel=2 + tiling（2 卡）均为 nightly `full_model` 覆盖。
  - nightly 另跑 T2V/I2V DFX configs：每项为随机数据、10 prompts、concurrency 1、seed 42、negative prompt、832×480、33 frames、4 steps、24 fps，比较单 H100 和 2×H100 CacheDiT/TP2/VAE patch-parallel=2/tiling 方案。它们只上传 JSON/log artifacts，未设置基线阈值；因此不是性能 gate，也不证明超出该配置与运行的性能或硬件结论。^[PR #6349]
- 单测：`tests/diffusion/models/hunyuan_video/test_hunyuan_video_quant_config_propagation.py`; e2e `tests/e2e/online_serving/test_hunyuan_video_15_expansion.py`;示例 `examples/online_serving/{text_to_video,image_to_video}/run_server_hunyuan_video_15.sh` 与对应 `run_curl_hunyuan_video_15.sh` 客户端脚本。
  - 树内已无原 ModelOpt FP8 exporter，也没有该模型专用的 quantization export example；审查与验证不得继续引用已删除的 example 路径。^[PR #5969]
- 已知未决：checkpoint 如何选 I2V 架构（推测经 model_index.json `_class_name`,解析链未追）;serving 文档是否期待用户显式传 YAML。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-video/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-04
- 来源（sources）：vllm_omni/diffusion/models/hunyuan_video/pipeline_hunyuan_video_1_5.py；vllm_omni/diffusion/models/hunyuan_video/pipeline_hunyuan_video_1_5_i2v.py；vllm_omni/diffusion/models/hunyuan_video/hunyuan_video_15_transformer.py；tests/e2e/online_serving/test_hunyuan_video_15_expansion.py
  - tests/dfx/perf/tests/test_hunyuanvideo15_t2v_vllm_omni.json；tests/dfx/perf/tests/test_hunyuanvideo15_i2v_vllm_omni.json；PR #5969；PR #6349
