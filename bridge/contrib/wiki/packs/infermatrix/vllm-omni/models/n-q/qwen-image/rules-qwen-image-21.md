---
name: rules-qwen-image-21
description: "Qwen-Image-2.1 规则 QWENIMG-1e：能力矩阵区分运行支持、未验证与模块能力，LoRA mixin 存在不等于变体已验证，SP/TP 与预量化 FP8 保留未验证边界，online FP8 对 DiT 与 text encoder 分别核对（PR #8099）"
metadata:
  scope: 只收 QWENIMG-1e 一条规则；QWENIMG-1a 至 1d 与 Qwen-Image-2.1 的 PR 规则归 qwen-image-rules
---
# Qwen-Image-2.1 能力与 FP8 证据边界

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen-image/rules-qwen-image-21.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #8099
- 置信度（confidence）：high
- [QWENIMG-1e] 能力矩阵区分运行支持、未验证与模块能力
  - 触发：修改 Qwen-Image-2.1 feature matrix、online FP8 或优化支持声明。
  - 强制：按实际 pipeline 和可执行证据标记能力：LoRA mixin 存在不等于该变体已验证；SP/TP 与预量化 FP8 保留未验证边界，TeaCache/DiT cache 不因 text prefix KV cache 可用而变支持。online FP8 分别核对 DiT 与 text encoder；语言部分量化，vision/LM head 保持 BF16。
  - 验收：支持声明引用对应 pinned tests 或实际运行 artifact，记录 GPU、head、checkpoint、prompt、分辨率与配置；矩阵与文档一致，缺证据保持未知。 ^[PR #8099]

## 决策与踩坑

- [QWENIMG-1e] 禁止：把继承/mixin 或其他变体测试当作本变体 ✅；将特定 H200 prompt/分辨率的内存和耗时扩大成通用保证。
