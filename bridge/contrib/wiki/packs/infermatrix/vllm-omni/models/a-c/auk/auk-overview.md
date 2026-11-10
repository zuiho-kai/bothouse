---
name: auk-overview
description: Tencent AuK / AuK-Flash owner 入口：对应 diffusion/models/auk/ 的 DiT / codec 与 entrypoints/openai/tts_adapters/auk.py 的 instruction-driven Speech API adapter，路由到 AuK 规则与 online FP8 量化规则，共享执行与 Speech API 公共输入输出的去处
metadata:
  scope: 只收 AuK 目录的入口和路由；task shortcut、DiT graph、codec tiling、reference cache、fused activation 的规则归 auk-rules，FP8 量化资格归 rules-fp8
---
# Tencent AuK / AuK-Flash

## 现状

- 本 owner 对应 `diffusion/models/auk/` 的 DiT/codec 与 `entrypoints/openai/tts_adapters/auk.py` 的 instruction-driven Speech API adapter。

| 遇到什么 | 查看哪里 |
|---|---|
| task shortcut、DiT graph/request context、codec tiling、reference latent cache 或 fused activation | [[auk-rules]]（AuK 规则） |

- 共享执行查 [[diffusion-overview]]（Diffusion owner）；Speech API 的公共输入与输出查 [[serving-overview]]（Serving owner）。
- [[rules-fp8]]（AuK online FP8 量化资格与验证）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/auk/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7469；PR #7881；PR #8300；PR #8328；PR #8305
- 置信度（confidence）：high
