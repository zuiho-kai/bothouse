---
name: owners-overview
description: vLLM-Omni 负责人入口：按 changed path 找 review owner 以上游 .github/CODEOWNERS 为准、committer 职责以 docs/community/governance.md 为准，本目录只保留关键模型与关键模块的 owner 路由，并指向 ownership projection 规则
metadata:
  scope: 只收 owners 目录的查看分流与不放什么的边界；模型 owner 表归 model_owner，模块 owner 表归 module_owner，module frontmatter 与 CODEOWNERS 投影规则归 owners-rules；模型代码入口与 registry 不在此目录
---
# vLLM-Omni 负责人

## 现状

### 什么时候查这里

- 需要确认关键模型、模块或工作主题由谁负责，找到对应 owner。
- 想在 review、debug 或 benchmark 时把问题路由到正确的人。

### 不放什么

- 模型代码入口、registry key 和别名；这些放 [[models-catalog]]（`models/catalog.md`）。
- 单个模型的实现与运行细节；这些放 `models/<模型>/`。
- 上游完整 path owner 或 committer 人员快照；人员会变动，路径审查负责人以目标 pin 的 `.github/CODEOWNERS` 为准，committer 身份与职责以 `docs/community/governance.md` 为准。本目录只保留确有独立维护价值的模型路由，不把两份权威清单复制成易过期表格。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 按 changed path 找 review owner | 上游 `.github/CODEOWNERS` | 权威且随 pin 变化；按 GitHub CODEOWNERS pattern 匹配，不从本地人员表推断 |
| 确认 committer 身份与公开职责 | 上游 `docs/community/governance.md` | governance roster 是角色权威来源，不等同于每条 path 的 required reviewer |
| 维护 module frontmatter → CODEOWNERS 投影 | [[owners-rules]]（ownership projection rules） | edit-first source map、additive overlay、last-match 与双向 parity |
| 关键模型与 Owner 清单 | [[model_owner]]（model_owner） | 模型 → 负责人对照表 |

- [[module_owner]]（module_owner）：维护者分工与发布政策。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/owners/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models；created: 2026-08-11；updated: 2026-09-22
- 来源（sources）：.github/CODEOWNERS；docs/community/governance.md；docs/design/module/；PR #5958
