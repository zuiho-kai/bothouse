---
name: components-ui-rules
description: "components-ui 审查规则：JW-WEB-UI-1a 共享 UI 迁移保持自动化契约（data-testid/data-variant 不改名），删除组件同步清理 package.json 打包步骤与测试引用（Toast/EmptyState/PickerDrawer；PR #7584）"
metadata:
  scope: 只收 JW-WEB-UI-1a 一条规则的触发、强制、禁止与验收；源码接口声明归 components-ui-contracts-01、components-ui-contracts-02、components-ui-contracts-03，入口说明归 components-ui-overview
---
# components-ui 审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-ui/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7584
- 置信度（confidence）：high
- [JW-WEB-UI-1a] 共享 UI 迁移保持自动化契约，删除组件同步清理测试脚本
  - 触发：迁移既有 UI 到 Toast/EmptyState/PickerDrawer 等共享组件，或删除前端组件。
  - 强制：保留已使用的 data-testid/data-variant；新增组件基名与 web/AGENTS.md 表一致；删除组件同时移除 package.json 中相关打包步骤和测试引用。
  - 验收：核对 DOM 契约和受影响的 UI 自动化；脚本无已删除组件引用，双语键同步。^[PR #7584]

## 决策与踩坑

- [JW-WEB-UI-1a] 禁止：仅为重构重命名稳定 testid；组件删除后仍执行其 esbuild/test 文件；把构建脚本存在当作测试已经通过。
