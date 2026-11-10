---
name: sana-video-architecture
description: "SANA Video 架构：native SanaVideoPipeline / SanaImageToVideoPipeline / SanaVideoTransformer3DModel 与共享模块边界、ReLU-kernel linear self-attention、sample_size 30 / 22 对应 480p / 704x1280 profile、Diffusers-adapter 的 SANA hooks 与 frames 映射、TP/CFG {1,2} 与 Cache-DiT/offload 限制、I2V 首帧 latent 与 mask、验证矩阵及 480p T2V 的 0.91 SSIM gate（PR #5508、PR #6953）"
metadata:
  scope: 只收 SANA Video 的模块边界、配置与兼容范围、主要流程和验证边界；入口与 checkpoint 速览归 sana-video-overview，TP/CFG、Cache-DiT/offload 与 refresh 的可执行规则 SANA-1a 至 1c 归 sana-video-rules
---
# SANA Video 架构

## 现状

### 模型专有部分与共享模块的边界

- `sana_video` owner 包含 native `SanaVideoPipeline`（T2V）、`SanaImageToVideoPipeline`（I2V）和 `SanaVideoTransformer3DModel`。Transformer 的 self-attention 是模型专有 ReLU-kernel linear attention；prompt cross-attention 交给共享 `vllm_omni.diffusion.attention.Attention`。
  - VAE、component discovery、offload、request batch、postprocess 与 worker 生命周期仍属于共享 diffusion owner。
- Serving 只通过 direct model metadata 将上述两个 pipeline 的 final output 分类为 `video`。共享 resolver 的优先级是 direct class、metadata alias、registry architecture class/alias、default；未知项仍为 image。该分类不提供或校验 I2V input schema，也不改变 denoise、topology 或 VAE。

### 配置、checkpoint 与兼容范围

- 两个 released 2B checkpoint 由 `sample_size` 决定默认 profile：30 对应 480×832，22 对应 704×1280。pipeline 只接受 Wan 或 LTX-2 video VAE class，分别接入对应 shared distributed wrapper；scheduler 保留 checkpoint 的 `DPMSolverMultistepScheduler` 配置。
- Diffusers-adapter 并非 native pipeline 的替代实现：它由 model class 选择 SANA-specific hooks。特别是 checkpoint 声明的 T2V Diffusers class 在请求 I2V 时必须改装为 Diffusers I2V class，且 shared `num_frames` 要翻译为 Diffusers 的 `frames`。native pipeline 的 TP/CFG 各仅支持 `{1,2}`，包括 TP2×CFG2；
  - SP、text-encoder TP、PP、HSDP 在加载前拒绝，精确 layout/CFG/I2V invariant 见 [[sana-video-rules]]（SANA-1a；源锚点 #sana-1a-native-sana-video-只支持-tpcfg-的-12-矩阵）。native T2V/I2V 的 Cache-DiT 与 CPU/layerwise offload 另限 TP=CFG=SP=1，且只允许 `cache_dit`（与 distributed layerwise offload 不可组合）；
  - Cache-DiT、TeaCache 和 step execution 不应混为同一能力，后两者仍未验证。加载在 default-device context 完成，offloader 拥有 runtime residency；精确 admission、hook lifecycle 与 refresh 规则见 [[sana-video-rules]]（SANA-1b/1c）。adapter 也不提供 native continuous batching 或并行能力。

### 从输入到输出的主要流程

- native T2V 解析 prompt、采样参数和 extras，按 profile 的分辨率 bin 处理尺寸，编码文本，初始化 latents，然后在 checkpoint scheduler 上运行 CFG denoise 并经 VAE 解码视频。真实请求将公共 image-oriented `num_frames=1` omitted sentinel 解析为 81；profile dummy run 保留一帧。
- I2V 在同一主干前处理输入 PIL image，按目标尺寸编码它，并把首帧 latent 写入初始 latents；conditioning mask 令该首帧在 denoise 中固定，同时使用 spatial timestep conditioning。没有 `multi_modal_data.image`、或传入不支持的 image type/path，必须在 model boundary 明确失败。

### 怎样验证功能、精度和性能

- 组件、权重名和 pipeline contract 由 `tests/diffusion/models/sana_video/` 覆盖。SANA I2V 不进入通用 tiny alignment harness（该 harness 不提供 image task）；专有 component tests 和 L4 `tests/e2e/online_serving/test_sana_video_expansion.py` 覆盖真实权重的 native/adapter、T2V/I2V、480p/720p matrix。
  - golden 与逐 stage alignment 仅用于调查数值变化，运行前需要其外部 artifact/硬件前提，不能把收集或跳过当作完整功能验证。480p T2V 的 frozen golden 只使用 case-specific 0.91 SSIM gate；其余三例保持 0.93。该差异从 native prompt cross-attention 的 vLLM-Omni Attention 与 reference SDPA 边界开始，不能据此放宽其他 case。^[PR #5508]
- PR #6953 的 `test_video_pipeline_capability.py` 是 CPU metadata unit test：它仅断言两种 SANA class 的最终 serving 分类为 video；PR 叙述的 online/offline 行为不构成新增 endpoint 或真实模型 E2E 覆盖。^[PR #6953]

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/sana-video/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-09-05
- 来源（sources）：PR #5508；PR #5861；PR #5882；PR #6953；vllm_omni/diffusion/model_metadata.py；vllm_omni/diffusion/models/sana_video/pipeline_sana_video.py；vllm_omni/diffusion/models/sana_video/pipeline_sana_video_i2v.py；vllm_omni/diffusion/models/sana_video/transformer_sana_video.py
  - vllm_omni/diffusion/models/diffusers_adapter/pipeline_utils.py；vllm_omni/diffusion/request.py；tests/diffusion/models/sana_video/test_cache_offload.py；tests/entrypoints/openai_api/test_video_pipeline_capability.py
- 置信度（confidence）：high
