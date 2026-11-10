---
name: 2026-07-10-pipeline-lessons-06
description: 错题：依赖命令被并行跑，producer -> consumer 必须顺序执行
metadata:
  scope: 只收 2026-07-10 Jianghan 数据管线错题 06 这一条的经过和规则；现行约束归 stages、data-contracts、handoff
---
# 2026-07-10 — 依赖命令被并行跑

## 关键事实

- 源页：`knowledge/repos/jianghan-roleplay-data-pipeline/pipeline/incidents/2026-07-10-pipeline-lessons-06.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-07-10-jianghan-pipeline-06`
- 归属：`repos/jianghan-roleplay-data-pipeline/pipeline`
- 状态：已提炼
- 搜索词：依赖命令被并行跑
- 影响范围：Jianghan 数据管线

## 决策与踩坑

### 2026-07-10 — 依赖命令被并行跑

- 曾经把 promote smoke 和 score-apply 并行，consumer 先跑导致输入不存在。
- 规则：只有独立读/独立检查可以并行；producer -> consumer 必须顺序执行。
