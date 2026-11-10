---
name: web-frontend-rules
description: "web-frontend 审查规则（PR #7788）：JW-WEB-QUOTA-1a 配额导航开关（WORKSPACE_QUOTA_ENABLED）必须走完整 HTML 注入链并清理残留 activeNav"
metadata:
  scope: 只收 JW-WEB-QUOTA-1a 一条规则（触发、强制、禁止、验收）；静态入口与注入相关的接口知识归 knowledge-web-frontend
---
# web-frontend 审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7788
- 置信度（confidence）：high
- [JW-WEB-QUOTA-1a] 配额导航开关必须走完整 HTML 注入链并清理残留导航
  - 触发：修改 dev-stable 的配额导航或 WORKSPACE_QUOTA_ENABLED Web 注入。
  - 强制：同步 env 声明、nginx sub_filter、app_web 注入、index.html 占位符和 TS window 类型；agents 只在配额开启时显示，approvals 还需 enterprise。关闭/切换版本时残留 activeNav 回到 chat。
  - 验收：个人/企业 × 开/关组合检查导航和残留会话恢复；两种 HTML 服务路径不残留占位符，前后端布尔语义一致。^[PR #7788]

## 决策与踩坑

- [JW-WEB-QUOTA-1a] 禁止：只隐藏按钮而保留不满足条件的 activeNav 页面；漏掉任一部署注入入口；将字符串 false 当真。
