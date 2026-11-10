---
name: yue2-overview
description: YuE2 模型规则入口：AR semantic frames、NAR/VAE synthesis queue 与请求完成边界归模型 owner，共享 runner 输入 hook 只做 opt-in 转发，并列出三个 YuE2 规则页
metadata:
  scope: 只收 YuE2 规则入口的一段总述和三个规则页的链接；synthesis 与完成边界规则归 yue2-rules，请求与 native tokenizer/数值合同归 rules-interface，SheetSage2 score handoff 归 rules-score-handoff
---
# YuE2 模型规则入口

## 现状

- YuE2 的 AR semantic frames、NAR/VAE synthesis queue 与请求完成边界属于本模型 owner；共享 runner 的输入 hook 只负责按模型 opt-in 转发 metadata。
- [[yue2-rules]]（YuE2 synthesis 与完成边界规则）
- [[rules-interface]]（请求/native tokenizer 与数值边界）
- [[rules-score-handoff]]（SheetSage2 score 与 speech request handoff）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/yue2/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, model-executor；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8407
