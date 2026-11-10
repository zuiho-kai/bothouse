---
name: tooling-overview
description: vLLM-Omni apps 与 tooling 入口：本 owner 负责仓库内示例 app、外部 UI adapter（如 ComfyUI）到公开接口的客户端合同，服务端 HTTP/OpenAI handler 仍归 Serving，并指向 tooling rules
metadata:
  scope: 只收 tooling 目录的职责边界与分流；OMNI-TOOL 规则正文归 tooling-rules，服务端 handler 归 serving 组件页
---
# Apps 与 tooling

## 现状

- 本 owner 负责仓库内示例 app、外部 UI adapter 和它们到 vLLM-Omni 公开接口的客户端合同；服务端 HTTP/OpenAI handler 仍归 [[serving-overview]]（Serving）。

| 遇到什么 | 查看哪里 |
|---|---|
| ComfyUI 输入/参数或离线 text-to-image artifact 保存 | [[tooling-rules]]（tooling rules） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/tooling/_index.md`（InferMatrixCopilot@ecfb84d0）；title: vLLM-Omni apps 与 tooling；type: index；tags: vllm-omni；created: 2026-09-02；updated: 2026-09-02
- 来源（sources）：apps/ComfyUI-vLLM-Omni/；examples/offline_inference/text_to_image/text_to_image.py
