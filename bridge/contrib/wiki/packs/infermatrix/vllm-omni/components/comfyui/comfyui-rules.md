---
name: comfyui-rules
description: "ComfyUI 规则 COMFY-1a：video node/client 的 mode 与 multipart 字段必须共用当前服务端和 checkpoint 的能力矩阵，按服务端字段名和输入顺序编码（PR #5756）"
metadata:
  scope: 只收 ComfyUI video node/client 的 review 规则；目录入口归 comfyui-overview，服务端请求校验归 serving 组件规则
---
# ComfyUI 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/comfyui/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-22；updated: 2026-09-22
- 来源（sources）：PR #5756
- [COMFY-1a] video mode 与 multipart 字段必须共享当前能力矩阵
  - 触发：ComfyUI video node/client 修改 frame、image/audio/video references 或 mode。
  - 强制：先按当前服务端和目标 checkpoint 的能力矩阵校验组合，再确定唯一 mode；node 与 client 使用同一矩阵，按服务端字段名和输入顺序编码 multipart。新增 first/last frame 或 reference 组合必须同步两端。
  - 验收：每个当前支持的组合断言最终 mode、multipart key/count/order；相邻非法组合在发送前失败。^[PR #5756]

## 决策与踩坑

- [COMFY-1a] 禁止：按字段遍历顺序覆盖 mode；把早期 MiniMax H3 的 reference 限制推广到所有模型或后续功能。
