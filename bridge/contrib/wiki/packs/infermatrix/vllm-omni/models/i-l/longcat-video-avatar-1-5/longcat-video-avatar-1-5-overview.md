---
name: longcat-video-avatar-1-5-overview
description: "LongCat-Video-Avatar-1.5 目录入口：meituan-longcat/LongCat-Video-Avatar-1.5 checkpoint 与 LongCatVideoAvatarPipeline registry key、单 stage offline 单设备（AT2V/AI2V、两说话人、AVC continuation）、默认 INT8 DiT 与 distilled LoRA 480p/93 帧/8 步、不包含的路径、Avatar 与基础 LongCat-Video 资产来源、单 H100 的容量提示（PR #4099）"
metadata:
  scope: 只收 Avatar 1.5 的名称范围、资产来源、资源边界与查阅入口；输入、加载、AVC cache 与证据边界规则 LCVA-* 归 longcat-video-avatar-1-5-rules，基础 LongCat-Image 归 longcat-image-overview
---
# LongCat-Video-Avatar-1.5

## 现状

### 名称与范围

- 正式 checkpoint：`meituan-longcat/LongCat-Video-Avatar-1.5`；diffusion registry key `LongCatVideoAvatarPipeline` 指向 `diffusion/models/longcat_video/`，并注册模型专属 pre/post process。
- 单 stage、offline、单设备 Avatar 1.5：支持单说话人 AT2V/AI2V、两说话人 AI2V，以及单/两说话人多 segment AVC continuation。默认 INT8 DiT、distilled LoRA、480p、93 frames、25 FPS、8 steps。
- 不包含基础 LongCat-Video T2V/I2V、旧 Avatar checkpoint、online serving、refinement/super-resolution/high-frequency 路径、BSA、SP/TP/CFG parallel 或 Cache-DiT/TeaCache/FBCache。

### 运行与资源边界

- Avatar checkpoint 提供 DiT、scheduler、Whisper、vocal separator 与 distilled LoRA；tokenizer、UMT5 text encoder 和 VAE 来自独立的基础 `meituan-longcat/LongCat-Video`。额外运行依赖由 `longcat-video-avatar` extra 安装。官方 recipe 和 advanced E2E 都绑定单张 H100；
  - recipe 的约 41.0/56.8 GiB 峰值分别只绑定 CPU/GPU component build、INT8+distill、93-frame AI2V exact case，是容量提示而非性能或质量 gate。
- 输入、加载、AVC cache 与证据边界见 [[longcat-video-avatar-1-5-rules]]（规则）。共享 diffusion 不变量见 [[diffusion-overview]]（Diffusion owner）。

### 什么时候查这里

- 修改 LongCat Avatar registry、checkpoint/LoRA/INT8 loading、audio/image/mask、AVC continuation、model-local KV cache 或 offline example/tests。
- 基础 LongCat-Image 仍查 [[longcat-image-overview]]（LongCat-Image owner）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/longcat-video-avatar-1-5/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-09-02；updated: 2026-09-02
- 来源（sources）：PR #4099；docs/models/supported_models.md；examples/offline_inference/longcat_video/end2end.py；recipes/meituan-longcat/LongCat-Video-Avatar-1.5.md；vllm_omni/diffusion/models/longcat_video/；vllm_omni/diffusion/registry.py
- 置信度（confidence）：high
