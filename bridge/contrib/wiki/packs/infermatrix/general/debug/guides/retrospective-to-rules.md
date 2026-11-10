---
name: retrospective-to-rules
description: 复盘语义分流：把复盘结论分流为 RULE/ARCHITECTURE/GUIDE/INCIDENT/DROP、选最近 owner、复盘四问、规则最小写法、incident 准入三条件
metadata:
  scope: 只收复盘结论怎样分流和落盘（语义分流、owner 选择、规则写法、错题准入）；任务枚举归 task-as-audit-enumeration，结论纪律归 conclusion-discipline
---
# 复盘语义分流

## 现状

- 什么时候使用：用户要求复盘、沉淀经验、总结教训，或者一次问题暴露出现有门禁缺口时使用。

## 关键事实

- 源页：`knowledge/general/debug/guides/retrospective-to-rules.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, debug；created: 2026-07-10；updated: 2026-07-29；sources: 无

### 默认产物是完成语义分流后的可执行结论

- 复盘不能先选 `rules.md` 再填内容。
- 动笔前必须完成语义分流台账（源链接 `../../../../doc/knowledge/contributing/incidents.md#动笔前的语义分流台账`），把每个内容单元唯一归为 RULE、ARCHITECTURE、GUIDE、INCIDENT 或 DROP。
- `rules.md` 最后编辑，只接收同时具备 trigger、must、forbid 和 acceptance 的硬门禁。
- 确有 RULE 候选时，再选择离根因最近、下次任务一定会读取的 owner：
  - 跨仓库都成立 → 对应 `general/<主题>/` 的规则入口；
  - 某仓库都成立 → 仓库主题规则；
  - 共享源码模块专有 → `repos/<仓库>/components/<模块>/rules.md`；
  - 某模型专有 → `repos/<仓库>/models/<模型>/rules.md`。
- “仓库专属”不能单独证明应该写进仓库根。
- 动笔前必须通过仓库根 `rules.md` 准入门禁（源链接 `../../../../doc/knowledge/contributing/page-rules.md#仓库根-rulesmd-准入门禁`），专项规则下沉到最近 owner，根页只保留路由。
- 规则必须让没有见过原事故的人也能执行，不依赖日期、issue 编号或聊天上下文。
- 没有合格 RULE 候选时允许不修改任何 `rules.md`。

### 写文件前先按语义分流

- “拆分”指把结论放进正确的现有执行面，不等于为每类内容新建文件。动笔前逐项分类：

| 内容 | 默认去向 |
|---|---|
| 可复用的必须、禁止和验收条件 | 最近 owner 的 `rules.md` |
| 稳定的职责、边界和数据流 | 最近 owner 的 `architecture.md` |
| 可复用但不是硬门禁的操作方法 | 对应主题的 `guides/` |
| 日期、PR/SHA、一次性测试数量、调查时间线 | 默认不落盘；需要追溯时使用 Git/PR 历史 |

- 正文完成后必须回到语义分流台账，执行 `RULES PURITY` 和 `DUPLICATE BODY` 检查。

### 复盘必须回答四个问题

1. 为什么会发生：沿真实入口、配置、运行时和失败位置证明根因。
2. 为什么以前没发现：指出缺失或失效的规则、校验、测试、日志或路由。
3. 怎样提前阻止：写出下一次必须执行的检查和禁止行为。
4. 怎样证明规则有效：绑定最小回归、验收信号或失败信息。

### 规则的最小写法

```markdown
### <人能看懂的规则标题>

- 触发条件：什么任务或现象出现时执行。
- 必须做：按什么顺序检查或验证。
- 禁止：哪种旧做法会掩盖问题。
- 验收：看到什么证据才算通过。
```

- 优先补现有规则，不为一句新结论创建新目录。
- 只有某个代码模块或模型已经形成独立 owner，且规则不适合继续放在仓库总规则里时，才创建它自己的 `rules.md`，并从 `_index.md` 明确链接。

### 什么时候才写错题

- incident 默认不创建。只有下面三项同时成立，才允许增加 `incidents/` 页面：
  1. 可执行结论已经进入 `rules.md`，稳定职责或数据流已经进入 `architecture.md`；
  2. 仍有无法由规则、架构或 Git/PR 历史有效承载的复杂复现、证据链或历史背景；
  3. 能写出未来会独立查询这份证据的具体触发问题，而不是“也许以后有用”。
- 创建前必须明确写出 `RULES_DONE`、`UNPRESERVED_EVIDENCE` 和 `FUTURE_QUERY` 三项准入理由；任一项为空就不创建。
- 用户明确要求保存完整事故记录时可以创建，但仍要先完成规则提炼，并填写这三项。
- 错题只补充规则，不替代规则。
- 正常任务从 `_index.md` 和 `rules.md` 开始；只有命中相似症状或需要历史证据时，才从规则中的链接进入错题。

## 决策与踩坑

- （写文件前先按语义分流）不得把时间线、一次性测试证据和聊天复述塞进 `rules.md`；也不得因为这些内容不属于规则，就自动创建 incident “先存着再说”。
- （写文件前先按语义分流）知识树脚本通过不代表语义归属正确。
