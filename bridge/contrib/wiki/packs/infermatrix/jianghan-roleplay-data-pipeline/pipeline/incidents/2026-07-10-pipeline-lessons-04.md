---
name: 2026-07-10-pipeline-lessons-04
description: 错题：Stage 边界混乱，Stage2/3/4 各测什么
metadata:
  scope: 只收 2026-07-10 Jianghan 数据管线错题 04 这一条的经过和规则；现行约束归 stages、data-contracts、handoff
---
# 2026-07-10 — Stage 边界混乱

## 关键事实

- 源页：`knowledge/repos/jianghan-roleplay-data-pipeline/pipeline/incidents/2026-07-10-pipeline-lessons-04.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-07-10-jianghan-pipeline-04`
- 归属：`repos/jianghan-roleplay-data-pipeline/pipeline`
- 状态：已提炼
- 搜索词：Stage 边界混乱
- 影响范围：Jianghan 数据管线

## 决策与踩坑

### 2026-07-10 — Stage 边界混乱

- 这些问题不能混在一起：

```text
模型怎么知道世界？
江涵在小说场景里怎么反应？
桌面助手怎么回答用户？
工具结果怎么汇报？
```

- 对应关系：

```text
Stage2 tests world facts.
Stage3 tests novel-style role reaction.
Stage4 tests desktop utility and task reporting.
```
