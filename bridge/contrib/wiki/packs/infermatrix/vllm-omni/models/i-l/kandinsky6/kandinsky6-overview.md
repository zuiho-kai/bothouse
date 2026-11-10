---
name: kandinsky6-overview
description: "Kandinsky 6 目录入口（PR #8537）：vllm_omni/diffusion/models/kandinsky6/ 与 Kandinsky6TI2VAPipeline 的 owner 范围，不能继承其他视频模型的请求、checkpoint 或缓存假设；Hub 分目录权重、音视频输出、参考图、请求缓存与 VAE patch parallel 的路由"
metadata:
  scope: 只收本模型 owner 范围与到规则页的路由；K6-1a 至 K6-2c 的规则正文归 kandinsky6-rules
---
# Kandinsky 6

## 现状

- 本 owner 对应 `vllm_omni/diffusion/models/kandinsky6/` 与 `Kandinsky6TI2VAPipeline`；不能继承其他视频模型的请求、checkpoint 或缓存假设。

| 遇到什么 | 查看哪里 |
|---|---|
| Hub 分目录权重、音视频输出、参考图、请求缓存与 VAE patch parallel | [[kandinsky6-rules]]（模型规则） |

- 共享执行与输出协议查 [[diffusion-overview]]（Diffusion owner）；公开 HTTP 请求与帧数校验查 [[serving-overview]]（Serving owner）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/kandinsky6/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8537
- 置信度（confidence）：high
