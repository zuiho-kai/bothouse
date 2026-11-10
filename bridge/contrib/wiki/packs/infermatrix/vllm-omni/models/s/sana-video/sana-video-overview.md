---
name: sana-video-overview
description: "SANA Video 目录入口：registry architecture SanaImageToVideoPipeline / SanaVideoPipeline 与 final_output_type=video、源码目录 sana_video、依赖的八个共享 diffusion 模块、480p（832×480）与 720p（1280×704）两个 2B checkpoint 与 Wan / LTX-2 VAE 选择、Diffusers 兼容 backend 的 I2V hook、num_frames 哨兵解析为 81、PR #6953 metadata 单测"
metadata:
  scope: 只收 SANA Video 的名称、registry、checkpoint 范围、专有流程与验证概述及目录路由；模型边界与验证细节归 sana-video-architecture，SANA-1a 至 1c 归 sana-video-rules，共享 diffusion 模块的合同归 diffusion-overview
---
# SANA Video

## 现状

### 正式名称与别名

- 知识树 owner：`models/sana-video`；上游目录 `sana_video`。
- registry 登记的 architecture / stage key：`SanaImageToVideoPipeline`；`SanaVideoPipeline`。
- 两者都在 direct diffusion metadata 中声明 `final_output_type="video"`，使 serving 将 final stage 分类为 video；这不定义或改变 I2V 请求输入、denoise、native/adapter topology 或 VAE 行为。

### 源码路径

- 共 5 个文件；native T2V/I2V pipeline、Transformer 与 output 都在：
  - `vllm_omni/diffusion/models/sana_video/`

### 依赖的共享代码模块

- `vllm_omni/diffusion/distributed/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/attention/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/models/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/data/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/offloader/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/request/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/worker/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/cache/` → [[diffusion-overview]]（diffusion）

### checkpoint、尺寸与兼容范围

- 支持 `Efficient-Large-Model/SANA-Video_2B_480p_diffusers`（832×480）和 `Efficient-Large-Model/SANA-Video_2B_720p_diffusers`（1280×704），均为单 GPU 的 SANA-Video 2B T2V/I2V 范围；SANA-Video 2.0 5B/14B 不在此实现范围。
- native pipeline 根据 checkpoint VAE class 选择共享分布式 Wan VAE 或 LTX-2 VAE wrapper；480p Wan VAE decode 使用 FP32，720p LTX-2 VAE 保持 pipeline dtype。scheduler 从 checkpoint 加载 `DPMSolverMultistepScheduler`，不能以“native”推断零 Diffusers 依赖。
- `--diffusion-load-format diffusers` 是兼容/reference backend。I2V 必须经 `SanaImageToVideoPipeline` class hook 选择 Diffusers I2V pipeline；其 `frames` 参数由共享 `num_frames` 映射，profile dummy run 仍允许一帧。

### 专有流程与验证

- T2V 用 native ReLU-kernel linear self-attention，prompt cross-attention 通过 vLLM-Omni Attention；不要把 SANA-Video 2B 误归为 gated linear attention。I2V 编码输入图像、固定首个 latent frame，并构造 first-frame conditioning mask。
- 请求未指定视频帧数时，image-model 的 `num_frames=1` sentinel 在真实请求边界解析为 81；dummy/profile run 保留一帧以避免昂贵启动路径。公开 extras 是 `clean_caption`、`motion_score` 与 `use_resolution_binning`；native `clean_caption=True` 明确不支持。
- 先运行 `tests/diffusion/models/sana_video/` 的组件回归；native/adapter、T2V/I2V、480p/720p 的真实权重功能覆盖在 L4 serving expansion。golden 与 stage-alignment 是按需 correctness 工具，不是默认 per-PR gate。
- PR #6953 另有 `tests/entrypoints/openai_api/test_video_pipeline_capability.py` 的 CPU metadata unit：只验证两种 SANA pipeline 名称的 serving output 分类为 video；PR 报告的 online/offline 情形不是新增 endpoint 或真实模型 E2E。

### 什么时候查这里

- 只查 SANA Video 专有的行为、常量、注册入口和验证合同。

### 不放什么

- 上面列出的共享模块的执行、调度、加载或 serving 合同属于 [[components-overview]]（components），这里只链接不复制；registry 快照和别名清单见 [[models-catalog]]（模型 catalog）；一次性历史默认不落盘。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| T2V/I2V、checkpoint、VAE、adapter 或验证边界 | [[sana-video-architecture]]（architecture） |
| native TP/CFG topology、GLUMB/RMSNorm layout、I2V parallel invariant、Cache-DiT/offload admission 或 SANA 50-step refresh | [[sana-video-rules]]（SANA rules） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/sana-video/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-09-05
- 来源（sources）：PR #5508；PR #5861；PR #5882；PR #6953；vllm_omni/diffusion/models/sana_video/；vllm_omni/diffusion/model_metadata.py；vllm_omni/diffusion/registry.py；vllm_omni/model_extras/sana_video.py；tests/diffusion/models/sana_video/test_cache_offload.py
  - tests/entrypoints/openai_api/test_video_pipeline_capability.py
- 置信度（confidence）：high
