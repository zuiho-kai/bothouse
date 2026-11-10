---
name: review-guides-overview
description: 代码审查指南索引的入口描述：源索引页对本目录各页“遇到什么情况查哪一页”的原始说法
metadata:
  scope: 只收源目录 general/review/guides 索引页的入口描述原文；各页正文归对应页面
---
# 代码审查指南

## 关键事实

- 源页：`knowledge/general/review/guides/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: general, review；created: 2026-07-10；updated: 2026-07-30；sources: 无
- 本页逐条保留源索引页的入口描述（其中有的说法与目标页自己的标题或描述不同）；链接已改为本 pack 的页面名。

### 代码审查指南

- 遇到什么：单次 Direct review、完整 diff review、需要具体减法建议、严格校验全入口覆盖或交给项目 owner 前验收
  - 查看哪里：[[review-execution-contract-1]]（独立审查执行合同）
- 遇到什么：删除死代码、重复生命周期状态或无依据的过度防御代码
  - 查看哪里：[[simplification-audit]]（simplification audit）
- 遇到什么：区分框架补丁和算法修复
  - 查看哪里：[[algorithm-vs-framework-fix]]（algorithm vs framework）
- 遇到什么：写代码前检查整体品味
  - 查看哪里：[[code-taste]]（code taste）
- 遇到什么：审查公开参数和 API
  - 查看哪里：[[code-taste-api-surface]]（API surface）
- 遇到什么：审查新增执行路径
  - 查看哪里：[[code-taste-review-flow]]（review flow）
- 遇到什么：避免在消费端写死生产端枚举
  - 查看哪里：[[codex-review-lessons]]（Codex review lessons）
- 遇到什么：避免调试时顺手扩大优化范围
  - 查看哪里：[[narrow-optimization-scope]]（narrow optimization scope）
- 遇到什么：理解四类维护者审查方法
  - 查看哪里：[[reviewer-lens-audit-1]]（reviewer lens audit）
- 遇到什么：查看审查案例
  - 查看哪里：[[reviewer-lens-cases]]（reviewer lens cases）
- 遇到什么：检查接口和生命周期约定
  - 查看哪里：[[reviewer-lens-contracts]]（reviewer lens contracts）
- 遇到什么：按风险选择审查门禁
  - 查看哪里：[[reviewer-lens-gates-1]]（reviewer lens gates）
- 遇到什么：使用可粘贴审查提示
  - 查看哪里：[[reviewer-lens-prompt-1]]（reviewer lens prompt）
- 遇到什么：算法判断前先读上游实现
  - 查看哪里：[[upstream-first-for-algorithm]]（upstream first）
