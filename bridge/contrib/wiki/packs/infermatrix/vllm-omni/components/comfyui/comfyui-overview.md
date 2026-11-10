---
name: comfyui-overview
description: ComfyUI 目录入口：何时查 ComfyUI video node/client 的 mode 选择、reference 组合与 multipart 编码，以及指向 COMFY-1a 的对照表
metadata:
  scope: 只收 components/comfyui 目录的适用场景和内容对照；规则正文归 comfyui-rules，服务端校验归 serving 组件，checkpoint 能力归对应模型
---
# ComfyUI

## 现状

### 什么时候查这里

- 修改 ComfyUI video node/client 的模式选择、reference 组合和 multipart 编码。
- 服务端校验回到 [[serving-overview]]（Serving）；checkpoint 能力回到对应模型 owner。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| video mode、reference 组合、请求字段一致性 | [[comfyui-rules]]（ComfyUI 规则）：`COMFY-1a` |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/comfyui/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, components, serving；created: 2026-09-22；updated: 2026-09-22
- 来源（sources）：PR #5756
