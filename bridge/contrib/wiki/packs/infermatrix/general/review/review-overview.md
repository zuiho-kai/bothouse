---
name: review-overview
description: 代码审查 目录总览：什么时候查这里、不放什么，以及目录内容的入口说明
metadata:
  scope: 只收源目录 general/review 索引页里的使用时机、收录边界和入口说明；具体方法归入口所指的各页
---
# 代码审查

## 现状

- 什么时候查这里：
  - 审查代码改动、寻找遗漏、重复实现、错误归属或公开接口影响。
- 不放什么：
  - 某个仓库专有的审查清单。
  - 单次 PR 的完整过程记录。

## 关键事实

- 源页：`knowledge/general/review/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: general, review；created: 2026-07-10；updated: 2026-09-10；sources: 无

### 目录内容

- 遇到什么：检查同族实现覆盖、条件分支对称性、PR 测试证据是否对齐 CI，或改动体量是否超预算
  - 查看哪里：[[review-rules]]（通用设计审查规则）
  - 说明：由代码结构、测试证据和变更体量触发的跨仓库门禁
- 遇到什么：从维护者视角审查当前改动，或只拿到 PR 链接
  - 查看哪里：[[review-execution-contract-1]]（独立审查执行合同）
  - 说明：一次 Direct 审查复用同一证据，同时完成正确性和设计减法，只输出一篇评论
- 遇到什么：查找其他审查专项
  - 查看哪里：[[review-guides-overview]]（guides 索引）
  - 说明：只继续读取当前风险命中的专项
