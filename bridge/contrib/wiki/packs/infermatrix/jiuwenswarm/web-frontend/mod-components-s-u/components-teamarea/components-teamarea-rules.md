---
name: components-teamarea-rules
description: "components-teamarea 审查规则：JW-WEB-TAB-1a 带内嵌关闭按钮的 tab 只处理自身键盘激活（ExpandedPanelTabs 的 role=tab 容器与 CloseButton，Enter/Space 事件委托；PR #7584）"
metadata:
  scope: 只收 JW-WEB-TAB-1a 一条规则的触发、强制、禁止与验收；源码接口声明归 components-teamarea-contracts-01、components-teamarea-contracts-02，入口说明归 components-teamarea-overview
---
# components-teamarea 审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-teamarea/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7584
- 置信度（confidence）：high
- [JW-WEB-TAB-1a] 带内嵌关闭按钮的 tab 只处理自身键盘激活
  - 触发：修改 ExpandedPanelTabs 的 role=tab 容器、CloseButton 或键盘事件委托。
  - 强制：Enter/Space 的切页处理器先确认 event.target===event.currentTarget；来自内部按钮的键盘事件保留按钮原生激活，点击关闭不冒泡为切页。
  - 验收：Tab 聚焦关闭按钮后 Enter 和 Space 均关闭目标页，不触发 onTabChange；聚焦 tab 自身仍可键盘切页。^[PR #7584]

## 决策与踩坑

- [JW-WEB-TAB-1a] 禁止：父 tab 对内部关闭按钮的 keydown 调用 preventDefault 并切页；只处理鼠标 stopPropagation 而漏掉键盘路径。
