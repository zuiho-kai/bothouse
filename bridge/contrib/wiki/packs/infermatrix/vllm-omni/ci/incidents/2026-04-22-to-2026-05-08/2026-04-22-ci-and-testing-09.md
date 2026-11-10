---
name: 2026-04-22-ci-and-testing-09
description: 2026-04-22 CI 错题 inc-2026-04-22-ci-and-testing-09，GEBench 测试函数没把 pytest 的 --samples-per-type 透传给 gbench_main，结果跑了全量数据集
metadata:
  scope: 只收 2026-04-22 GEBench test 未透传 --samples-per-type 这一起错题的症状、解法和提醒；GEBench judge 打分失真归 2026-05-08-ci-and-testing-18，错题总表归 ci-incidents-overview
---
# 2026-04-22 — GEBench test 未传 --samples-per-type

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-04-22-ci-and-testing-09.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-22-ci-and-testing-09`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：GEBench test 未传 --samples-per-type
- 影响范围：repos/vllm-omni/ci
- **症状**：pytest 传了参数但测试函数没透传，跑了全量数据集
- **解法**：测试函数接收 fixture 并传给 `gbench_main`
- **提醒**：GEBench 每样本 6 张图，smoke test 用 `--samples-per-type 1`
