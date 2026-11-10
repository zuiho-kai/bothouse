---
name: rules-quality
description: "MiniMax H3 质量验证：MMH3-4a2 official-reference accuracy oracle 的 checkpoint 与 asset 必须 pin immutable revision/digest，video 做视觉相似度、audio 必须比较内容或质量而非仅 codec metadata（PR #5709）"
metadata:
  scope: 只收 official-reference accuracy test 的 oracle 规则；部署证据归 rules-deployment-1、rules-deployment-2，ComfyUI 与 VAE 确定性归 rules-comfyui-audio、rules-audio-vae-determinism
---
# MiniMax H3 质量验证规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-quality.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-22；updated: 2026-09-22
- 来源（sources）：PR #5709
- [MMH3-4a2] official-reference oracle 必须 immutable 且覆盖两个 modality
  - 触发：新增或修改 H3 official-reference accuracy test、golden、threshold 或支持声明。
  - 强制：checkpoint 和 reference asset 分别 pin 到可解析的 immutable revision/digest；prompt、request 参数、执行 topology 与阈值绑定同一 exact case。video 做 metadata 与视觉相似度，audio 除 codec/rate/channel metadata 外还必须比较内容或质量。
  - 验收：昂贵 server startup 前完成 revision/digest preflight；exact case 满足 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（DIFF-3a） 与 [[ci-rules-1]]、[[ci-rules-2]]、[[ci-rules-3]]（VOMNI-CI-1b），视觉和音频 scorer 都有正向结果及损坏单一 modality 的反例。 ^[PR #5709]

## 决策与踩坑

- [MMH3-4a2] 禁止：用 `resolve/main` 作 golden；假定权重 revision 一定包含 asset；把 AAC/32 kHz/stereo metadata 通过当作 audio accuracy；用另一硬件的结果为当前 CI lane 背书。
