---
name: 2026-07-10-pipeline-lessons-03
description: 错题：原文高可信被误当成原样可训练，及正确转换
metadata:
  scope: 只收 2026-07-10 Jianghan 数据管线错题 03 这一条的经过和规则；现行约束归 stages、data-contracts、handoff
---
# 2026-07-10 — 原文高可信被误当成原样可训练

## 关键事实

- 源页：`knowledge/repos/jianghan-roleplay-data-pipeline/pipeline/incidents/2026-07-10-pipeline-lessons-03.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-07-10-jianghan-pipeline-03`
- 归属：`repos/jianghan-roleplay-data-pipeline/pipeline`
- 状态：已提炼
- 搜索词：原文高可信被误当成原样可训练
- 影响范围：Jianghan 数据管线

## 决策与踩坑

### 2026-07-10 — 原文高可信被误当成原样可训练

- Stage3 v1 把原文场景压成“江涵下一句直接台词”，出现大量 `嗯……`、`吃。`、`好的。`。这些在小说里有上下文支撑，单独训练会教模型安全短答和低主动性。
- 正确转换：

```text
原文 evidence -> mechanism / reaction_intent -> complete narrative target
```
