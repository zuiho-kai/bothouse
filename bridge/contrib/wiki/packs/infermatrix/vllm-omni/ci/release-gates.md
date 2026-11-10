---
name: release-gates
description: vLLM-Omni 发布规范：release 前 8 项门禁表（UT coverage、性能回退 < 10%、CUDA L1–L5 与 NPU L1/L2/L4 通过率 100%、需求完成率 > 85%、剩余 DI < 30、无 critical、bug 全有 assignee）及验收记录要求
metadata:
  scope: 只收 vLLM-Omni 版本 release 前门禁表（Guide 项与 Gate 项）和发布 checklist 的验收记录格式；测试分级定义归 test-tiers，CI 审查规则归 ci-rules-1 等规则页
---
# 发布规范

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/release-gates.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, ci；created: 2026-08-28；updated: 2026-09-22
- 来源（sources）：https://github.com/JiusiServe/InferMatrixCopilot/pull/70
- vLLM-Omni 版本 **release 前**必须满足以下门禁。标注 `(Guide)` 的项按当期迭代指南解释与举证；其余为硬性门槛。相关入口：[[ci-overview-1]]、[[ci-overview-2]]（CI 索引）、DI 计算说明（源链接 `../../../general/bug/guides/di-calculation.md`）、[[benchmark-overview]]（benchmark）。

### Release 前门禁

| # | 要求 | 类型 | 说明 |
|---|---|---|---|
| 1 | UT coverage meets this iteration requirement | Guide | 单元测试覆盖率达到当期迭代要求；具体阈值与举证方式以当期 Guide 为准 |
| 2 | Performance regression < 10% | Guide | 性能回退小于 10%；对比基线、指标与证据口径以当期 Guide 为准 |
| 3 | Latest CUDA L1 & L2 & L3 & L4 & L5 (excluding Non-critical) pass rate = 100% | Gate | 最新一轮 CUDA L1/L2/L3/L4/L5 中，排除 Non-critical 后通过率必须为 100% |
| 4 | Latest NPU L1 & L2 & L4 pass rate = 100% | Gate | 最新一轮 NPU L1/L2/L4 通过率必须为 100% |
| 5 | Requirement completion rate > 85% | Gate | 需求完成率大于 85% |
| 6 | Remaining DI < 30 | Gate | 剩余 DI 小于 30；DI 计算见 DI 计算说明（源链接 `../../../general/bug/guides/di-calculation.md`） |
| 7 | No remaining critical issues | Gate | 无未关闭的 critical 问题 |
| 8 | All remaining bugs have assignees | Gate | 所有剩余 bug 均已指派负责人 |

### 验收记录

- 发布前在发布说明或 checklist 中逐项给出：
  - 是否通过（Pass / Fail / N/A）
  - 证据链接（CI run、benchmark 报告、需求看板、DI 统计、issue 列表）
  - Guide 项写明当期 Guide 版本或链接
