---
name: magi-human-overview
description: "MagiHuman 已移除的 first-party 支持墓碑：PR #6357 在 main @ aeb348d8 删除 MagiHumanPipeline registry 与 pre/post 项、diffusion/models/magi_human 实现、model-extras、测试与文档；前一快照 40dcfdbb 曾是音频驱动人像视频 pipeline，仅作历史背景"
metadata:
  scope: 只收 MagiHuman 被移除这一事实与历史背景；共享 diffusion 运行时问题归 diffusion-overview
---
# MagiHuman — historical tombstone

## 现状

- PR #6357 removed first-party MagiHuman support at `main @ aeb348d8`: its `MagiHumanPipeline` registry and pre/post-processing entries, the `vllm_omni/diffusion/models/magi_human/` implementation, the model-extras declarations, tests, and supported-model/feature documentation are gone.
- At the immediately preceding snapshot (`40dcfdbb`), it was an audio-driven portrait-video pipeline with base and super-resolution DiTs plus audio/video VAEs. This is historical context only: it is not an active pipeline, support claim, model-extras contract, runnable example, or review owner.
  - Shared runtime questions belong to [[diffusion-overview]]（Diffusion）.^[PR #6357]

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/magi-human/_index.md`（InferMatrixCopilot@ecfb84d0）；title: MagiHuman（已移除的 first-party 支持）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-04
- 来源（sources）：PR #6357
