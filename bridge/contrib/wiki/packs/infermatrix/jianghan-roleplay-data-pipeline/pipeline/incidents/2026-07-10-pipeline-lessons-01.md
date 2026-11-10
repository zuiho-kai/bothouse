---
name: 2026-07-10-pipeline-lessons-01
description: 错题：用户纠偏没有立刻升级成硬约束，纠偏后必须写当前路线
metadata:
  scope: 只收 2026-07-10 Jianghan 数据管线错题 01 这一条的经过和规则；现行约束归 stages、data-contracts、handoff
---
# 2026-07-10 — 用户纠偏没有立刻升级成硬约束

## 关键事实

- 源页：`knowledge/repos/jianghan-roleplay-data-pipeline/pipeline/incidents/2026-07-10-pipeline-lessons-01.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-07-10-jianghan-pipeline-01`
- 归属：`repos/jianghan-roleplay-data-pipeline/pipeline`
- 状态：已提炼
- 搜索词：用户纠偏没有立刻升级成硬约束
- 影响范围：Jianghan 数据管线

## 决策与踩坑

### 2026-07-10 — 用户纠偏没有立刻升级成硬约束

- 用户多次否定 CoSER、Top100、生成样本、短回复 target 后，旧路线仍反复回流。
- 以后强用户纠偏后必须写五行当前路线：

```text
Current route:
Stage:
Allowed sources:
Forbidden sources:
Output shape:
Review gate:
```

- 写不清就不能继续实现。
