---
name: seedvr2-overview
description: SeedVR2 目录入口：diffusion/models/seedvr2/ 的 restoration pipeline、admission 与 model-specific long-video route hook 的 owner 范围，以及到 SeedVR2 规则页的路由（clip budget、长视频动态窗口、时序拼接、作业取消与文件生命周期）
metadata:
  scope: 只收 SeedVR2 的 owner 范围与规则页路由；SEED-1a 至 1f 与两条 VLLM-OMNI-PR 规则归 seedvr2-rules，共享模型加载与并行执行归 diffusion-overview，公共 HTTP 装配归 serving-overview
---
# SeedVR2

## 现状

- 本 owner 对应 `diffusion/models/seedvr2/` 的 restoration pipeline、admission 与 model-specific long-video route hook。

| 遇到什么 | 查看哪里 |
|---|---|
| restoration clip budget、长视频动态窗口、时序拼接、作业取消与文件生命周期 | [[seedvr2-rules]]（SeedVR2 规则） |

- 共享模型加载与并行执行查 [[diffusion-overview]]（Diffusion owner）；公共 HTTP 装配查 [[serving-overview]]（Serving owner）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/seedvr2/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8102
- 置信度（confidence）：high
