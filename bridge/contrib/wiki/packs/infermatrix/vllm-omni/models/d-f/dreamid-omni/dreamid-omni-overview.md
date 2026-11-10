---
name: dreamid-omni-overview
description: "DreamID-Omni 历史墓碑页：PR #6357 在 main @ aeb348d8 移除 first-party 支持（DreamIDOmniPipeline registry 入口、pre/post-processing 注册、diffusion/models/dreamid_omni/ 实现、测试、文档与共享 x_to_video_audio 示例）；前一快照 40dcfdbb 时它是基于 Wan2.2 的音视频 identity pipeline，现不可当作 registry 目标、受支持 checkpoint 或 review owner"
metadata:
  scope: 只收 DreamID-Omni 被移除的事实与历史背景；现存 Wan 家族归 wan2-2-overview，共享运行时行为的入口归 diffusion-overview
---
# DreamID-Omni — historical tombstone

## 现状

- PR #6357 removed first-party DreamID-Omni support at `main @ aeb348d8`: its `DreamIDOmniPipeline` registry entry and pre/post-processing registration, the `vllm_omni/diffusion/models/dreamid_omni/` implementation, model tests, setup script, documentation,
  - and the shared `x_to_video_audio` example are gone.
- At the immediately preceding snapshot (`40dcfdbb`), the removed implementation was a custom Wan2.2-based audio/video identity pipeline with an external `dreamid_omni` dependency.
  - This is historical context only: do not treat it as a current registry target, supported checkpoint, runnable example, or review owner. For the remaining Wan family, use [[wan2-2-overview]]（Wan2.2）; for shared runtime behavior, use [[diffusion-overview]]（Diffusion）.^[PR #6357]

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/dreamid-omni/_index.md`（InferMatrixCopilot@ecfb84d0）；title: DreamID-Omni（已移除的 first-party 支持）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-04
- 来源（sources）：PR #6357
