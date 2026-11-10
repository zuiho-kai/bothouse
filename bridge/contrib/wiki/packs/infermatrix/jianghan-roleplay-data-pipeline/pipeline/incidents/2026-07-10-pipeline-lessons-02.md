---
name: 2026-07-10-pipeline-lessons-02
description: 错题：Reference quality 被误当成 training suitability
metadata:
  scope: 只收 2026-07-10 Jianghan 数据管线错题 02 这一条的经过和规则；现行约束归 stages、data-contracts、handoff
---
# 2026-07-10 — Reference quality 被误当成 training suitability

## 关键事实

- 源页：`knowledge/repos/jianghan-roleplay-data-pipeline/pipeline/incidents/2026-07-10-pipeline-lessons-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-07-10-jianghan-pipeline-02`
- 归属：`repos/jianghan-roleplay-data-pipeline/pipeline`
- 状态：已提炼
- 搜索词：Reference quality 被误当成 training suitability
- 影响范围：Jianghan 数据管线

## 决策与踩坑

### 2026-07-10 — Reference quality 被误当成 training suitability

- SillyTavern/worldbook prompt 运行时表现好，是因为 inference context 大，不代表它的生成回复能做 fine-tune gold。
- 区分：

```text
good reference != training gold
```
