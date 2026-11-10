---
name: components-cronpanel-rules
description: "components-cronpanel 审查规则：JW-WEB-CRON-1a 超限输入保留原值并向抽屉报告非法状态（dev-stable CronTaskDrawer/ScheduleEditor 的 cron、整数、提前唤醒分钟输入；PR #7817）"
metadata:
  scope: 只收 JW-WEB-CRON-1a 一条规则的触发、强制、禁止与验收；源码接口声明归 components-cronpanel-contracts-01、components-cronpanel-contracts-02，入口说明归 components-cronpanel-overview
---
# components-cronpanel 审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-cronpanel/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7817
- 置信度（confidence）：high
- [JW-WEB-CRON-1a] 超限输入保留原值并向抽屉报告非法状态
  - 触发：修改 dev-stable CronTaskDrawer/ScheduleEditor 的 cron、整数或提前唤醒分钟输入。
  - 强制：区分校验与规范化；超限分钟保留用户输入，通过合法性回调上报并禁用保存，将该字段加入待修正提示；校验纯函数保留独立测试。
  - 验收：运行 cron-expr-validation、cron-integer-input、cron-wake-offset 的定向用例；超限时原值可见且保存禁用，修正后可保存。^[PR #7817]

## 决策与踩坑

- [JW-WEB-CRON-1a] 禁止：在输入阶段静默 clamp 超限值；仅依靠后端校验；把展示规范化后的值当作原输入合法。
