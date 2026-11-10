---
name: 2026-07-10-pipeline-lessons-05
description: 错题：Training 早于 review gates，训练前必须已存在的材料
metadata:
  scope: 只收 2026-07-10 Jianghan 数据管线错题 05 这一条的经过和规则；现行约束归 stages、data-contracts、handoff
---
# 2026-07-10 — Training 早于 review gates

## 关键事实

- 源页：`knowledge/repos/jianghan-roleplay-data-pipeline/pipeline/incidents/2026-07-10-pipeline-lessons-05.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-07-10-jianghan-pipeline-05`
- 归属：`repos/jianghan-roleplay-data-pipeline/pipeline`
- 状态：已提炼
- 搜索词：Training 早于 review gates
- 影响范围：Jianghan 数据管线

## 决策与踩坑

### 2026-07-10 — Training 早于 review gates

- 训练前必须已存在：

```text
source policy documented
candidate JSONL
review markdown
review scores or explicit owner acceptance
promoted train JSONL non-empty
audit JSON/MD without hard stop
stage-matched eval JSONL
```

- 缺一个都不能“先训看看”。
