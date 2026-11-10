---
name: product-loop-planning
description: Product Loop Planning：先写用户可感知的产品闭环再拆技术任务，七个闭环问题、atomic issue 判断、sub-agent / PR 前检查、2026-06 事故来源
metadata:
  scope: 只收“对标类/产品目标类任务怎样先写产品闭环再拆 issue”这一方法及其事故来源；mini spec 模板归 mini-spec，实现与验证方法归 implementation-validation
---
# Product Loop Planning

## 现状

- **何时来翻**：用户说“对标某项目 / 做到某体验 / 最低 parity / 产品书 / roadmap / 版本目标”，或者已经抱怨“拆得太散、PR 很多但功能没感觉”。

## 关键事实

- 源页：`knowledge/general/planning/guides/product-loop-planning.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, planning；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 核心规则

- 先写用户可感知的产品闭环，再拆技术任务。
- 错误拆法是直接把目标拆成技术名词清单，例如 summary、recall、source UI、scheduler、privacy、provider UX、benchmark。这样会制造 feature checklist 污染：每个 PR 都能独立通过测试，但用户仍然感受不到目标产品已经成立。
- 正确拆法先回答：

1. 用户自然做什么？
2. 系统后台判断什么？
3. 系统保存或改变什么长期状态？
4. 未来用户或环境怎么触发它？
5. 系统怎么以自然产品语言表现出来？
6. 用户怎么检查、纠正、关闭或删除？
7. 哪个 benchmark / harness 证明这条闭环，而不是只证明某个函数？

- 只有这条闭环写清楚后，才允许拆 atomic issue。

### Atomic issue 判断

- 一个 atomic issue 必须关闭一个用户可感知的闭环切片。它可以很小，但不能只是“实现某内部模块”。如果 issue 只能说“新增 X 层 / Y 类型 / Z 算法”，却说不清用户完成了什么、之后会自然发生什么，就还不是可执行 issue。
- 每个 issue 至少写：
  - 用户可感知结果；
  - 当前产品状态和缺口；
  - 这次闭环从哪里开始、到哪里结束；
  - 非目标；
  - 验收证据；
  - 后续闭环依赖。

### Sub-agent / PR 前检查

- 开 sub-agent 或 PR 前，main agent 必须把计划对照产品闭环审一遍：
  - 如果计划只是技术模块列表，停下重拆。
  - 如果多个 issue 都只覆盖同一闭环的内部零件，合并或改成一个集成闭环 PR。
  - 如果一个 PR 开始补相邻闭环，拆出去。
  - 如果 benchmark 得分很高但用户体验仍然不成立，说明 benchmark 只测了零件，必须补闭环场景。

## 决策与踩坑

### 事故来源

- 2026-06 Greyfield / MaiBot-parity 记忆规划中，先按 summary、semantic recall、source drilldown、scheduler、privacy、promise、ritual、scene 拆 issue，导致 PR 数量增加但产品闭环推进感弱。根因不是拆得不够细，而是先按技术模块拆，后试图拼回产品体验。
- 以后遇到同类产品对标任务，先写“自然使用 -> 后台判断 -> 长期状态 -> 未来触发 -> 自然表达 -> 用户控制 -> 验收证据”的闭环，再拆 issue。
