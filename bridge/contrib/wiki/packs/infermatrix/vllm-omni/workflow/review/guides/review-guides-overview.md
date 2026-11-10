---
name: review-guides-overview
description: vLLM-Omni 审查指南分流表：按 PR 描述路由 owner/model 代码地图、审查模型适配完整性、strict 审查触发式检查单（streaming 生命周期、平台默认值、依赖下界、CI marker、测试有效性、bugfix 回归覆盖）、新模型验证是否证明语义正确
metadata:
  scope: 只收 review/guides 目录按场景查指南的对照表；各指南正文归 maintainer-pattern-routing、model-adaptation-guardrails-1、model-adaptation-guardrails-2、strict-review-checklist、model-validation，审查方法总述归 review-overview
---
# vLLM-Omni 审查指南

## 现状

| 遇到什么 | 查看哪里 |
|---|---|
| 按 PR 描述先路由到精确 owner/model 代码地图，再用 changed files 校验范围 | [[maintainer-pattern-routing]]（PR intent maintainer routing） |
| 审查模型适配 PR 的完整性 | [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model adaptation guardrails） |
| Strict 审查注入的触发式检查单（streaming 生命周期、平台默认值影响面、依赖下界、CI marker 选择、测试有效性、bugfix 回归覆盖） | [[strict-review-checklist]]（strict review checklist） |
| 判断新模型验证是否证明语义正确 | [[model-validation]]（model validation） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/review/guides/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, review；created: 2026-07-10；updated: 2026-07-30
