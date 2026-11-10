---
name: 2026-04-28-profiling-and-model-loading-17
description: 2026-04-28 错题：monkey-patch F.scaled_dot_product_attention 对 trust_remote_code 模型没生效，模型直接调 torch.nn.functional 的已绑定引用
metadata:
  scope: 只收 2026-04-28 monkey-patch SDPA 不生效这一起事故及直接 patch 模型源文件（snapshot 和 cache 两处）的解法；patch 被覆盖归 2026-04-28-profiling-and-model-loading-07，patch 路径错误归 2026-04-28-profiling-and-model-loading-18
---
# 2026-04-28 — monkey-patch F.scaled_dot_product_attention 没生效

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-28-profiling-and-model-loading-17.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-28-profiling-and-model-loading-17`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：monkey-patch F.scaled_dot_product_attention 没生效
- 影响范围：repos/vllm-omni/benchmark
- **症状**：替换了 `torch.nn.functional.scaled_dot_product_attention`，但模型代码里的诊断 print 没出现
- **根因**：模型文件用 `import torch.nn.functional as F` 后直接调 `torch.nn.functional.scaled_dot_product_attention(...)`，monkey-patch `F.scaled_dot_product_attention` 不影响已绑定的引用
- **解法**：直接 patch 模型源文件（snapshot + cache 两个位置），加 print 语句
- **对未来的提醒**：monkey-patch 标准库函数对 `trust_remote_code` 模型不可靠，直接改源文件更稳
