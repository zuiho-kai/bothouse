---
name: 2026-07-10-pipeline-lessons-07
description: 错题：本地 Python 版本被假设过高，保持 Python 3.9 兼容
metadata:
  scope: 只收 2026-07-10 Jianghan 数据管线错题 07 这一条的经过和规则；现行约束归 stages、data-contracts、handoff
---
# 2026-07-10 — 本地 Python 版本被假设过高

## 关键事实

- 源页：`knowledge/repos/jianghan-roleplay-data-pipeline/pipeline/incidents/2026-07-10-pipeline-lessons-07.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-07-10-jianghan-pipeline-07`
- 归属：`repos/jianghan-roleplay-data-pipeline/pipeline`
- 状态：已提炼
- 搜索词：本地 Python 版本被假设过高
- 影响范围：Jianghan 数据管线

## 决策与踩坑

### 2026-07-10 — 本地 Python 版本被假设过高

- 本地 Python 3.9 不支持某些新特性：

```text
zip(..., strict=True)
Path.write_text(..., newline=...)
```

- 脚本除非项目显式声明，否则保持 Python 3.9 兼容。至少跑一次真实脚本路径，不能只 compile。
