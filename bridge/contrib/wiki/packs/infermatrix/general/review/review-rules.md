---
name: review-rules
description: 跨仓库通用设计审查规则 REV-1a…REV-3b：同族覆盖、分支对称、证据复用、减法、10 分钟预算、CI 命令对齐、PR 体量
metadata:
  scope: 只收跨仓库都成立、能由代码结构触发的设计审查门禁（REV-*）；仓库、组件、模型专有不变量归各自 owner 规则页，审查执行步骤归 review-execution-contract
---
# 通用设计审查规则

## 现状

- 本页只放跨仓库都成立、能由代码结构触发的设计门禁。仓库、组件和模型专有不变量仍由最近的 owner 规则负责。
- 具体审查执行顺序见 [[review-execution-contract-1]]（独立审查执行合同），输入、输出与边界矩阵写法见 [[reviewer-lens-contracts]]（Reviewer Lens Contracts）。

## 关键事实

- 源页：`knowledge/general/review/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: general, review；created: 2026-07-30；updated: 2026-09-10
- 来源：
  - InferMatrixCopilot Issue #17
  - InferMatrixCopilot Issue #24
  - vllm-project/vllm-omni PR #5394
  - zuiho-kai/claude-workflow-starter@c217fc6
  - owner review-rule request 2026-09-10
  - JiusiServe/omni-reviewbot PR #56
  - JiusiServe/omni-reviewbot PR #57
- 置信度（confidence）：high
- 每条规则的「禁止」项在 决策与踩坑 一节，按同一规则 ID 对应。

### 同族实现覆盖

- [REV-1a] 修改同族实现时先闭合同族集合
  - 触发：改动共享同一公开合同、注册入口、基类或命名族的一部分实现，例如同目录的 `pipeline_*`、同类 adapter/backend 或同一功能的多种输入模式。
  - 强制：先从注册表、factory、基类或调用方枚举真实同族；逐项标记“同步修改”、“无需修改及原因”或“独立 owner”，再检查共享逻辑是否应上提到共同 owner。
  - 验收：审查记录包含完整同族清单和逐项结论；至少验证一个已修改变体，并对每个未修改变体提供代码边界、合同差异或最小回归证据。 ^[vllm-project/vllm-omni PR #5394]

### 条件分支对称

- [REV-1b] 同一语义的条件分支必须证明分叉必要且合同对称
  - 触发：同一职责按 TP size、设备、dtype、backend、feature flag 或兼容模式选择不同实现。
  - 强制：写明为何不能共用一条实现，并逐项比较两边的输入、输出、状态、错误语义和下游 consumer；能够统一时删除分叉，不能统一时把差异固化为显式合同。
  - 验收：同一入口覆盖条件边界两侧及切换边界，断言用户可观察结果或明确允许的差异；新增共享行为时，两条路径的测试或不适用理由必须同时出现。 ^[vllm-project/vllm-omni PR #5394]

### 审查角色与减法

- [REV-2a] 一次 Direct 审查复用同一份证据
  - 触发：用户要求审核 PR，包括只提供 PR 链接。
  - 强制：冻结 base/head 和授权合同；一次获取 PR 描述、changed files、diff、caller、tests 与已有 findings，并把精确 owner/model 规则组加入同一个 Codex review。主审查始终追行为和 producer→consumer；只有 REV-2b 信号触发时才继续减法检查。
  - 验收：一份内部报告覆盖 correctness 和减法信号分类；触发时补减法结果，未触发时记录 `subtraction_signal=none`。一篇对外评论给出合并后的 findings 和 verdict。^[InferMatrixCopilot Issue #24]
- [REV-2b] 减法先删越界 scope，再压缩模块设计
  - 触发：PR 新增或扩张 public behavior、helper、class、fallback 或兼容分支。
  - 强制：先把每项变化映射到用户目标或当前 RFC/mini spec slice，未映射项 `DELETE / DEFER`；再枚举保留 abstraction，写出不依赖当前实现的最小 owner 设计，逐项标记 `KEEP / INLINE / MERGE / MOVE / DELETE`，优先最小修改和复用既有 owner。
  - 验收：触发时报告 scope 删除项和模块 abstraction/owner/分支的净减少；没有可删项时给出最小设计证据。未触发时直接记录 `subtraction_signal=none`，不要求 ledger、census 或最小性证明。^[zuiho-kai/claude-workflow-starter@c217fc6]
- [REV-2c] 交互式 PR review 必须按时返回最小可用结论
  - 触发：用户未指定深审或更长预算，只要求审核 PR。
  - 强制：默认端到端预算 10 分钟；60 秒内先在宿主对话报告 head、CI、可合并性和早期 finding。固定快照后并行推进状态、知识/源码、验证三条证据轨并复用同一证据包。只有新颖、矛盾或未覆盖的高风险合同才允许在剩余预算内追加有边界的专项追问；截止时停止新工具调用，返回当前 finding、已触发的减法结果和未验证边界。
  - 验收：10 分钟内给用户 actionable findings 或明确的 `partial review`；更深验证作为后续可选任务，不阻塞本轮答复。 ^[InferMatrixCopilot Issue #24]

### 测试证据

- [REV-3a] PR 的测试证据必须对齐 CI 实际执行的命令
  - 触发：PR 描述声称已验证（Test Plan / Test Result、贴出命令或结果），或改动落在有 CI 看护用例的特性、模型或硬件路径上。
  - 强制：以冻结 head 的 CI 定义为准反查看护 step —— pipeline step 的 `commands` 是 CI 真正执行的命令，`source_file_dependencies` 声明它看护哪些改动路径，marker 语义以 `pyproject.toml` 为准。逐条比对 lane 命令与 PR 报告的命令是否选中同一组用例：test target、`-m` 表达式、run-level 或等价门必须一致。
  - 验收：审查记录列出命中的看护 step、其 lane 命令、PR 报告的命令和等价结论。缺测试证据、看护 step 未执行或 selector 不一致时给出阻断级 finding，点名 step label 与两条命令；只跑子集时必须写明未覆盖部分。^[owner review-rule request 2026-09-10] ^[JiusiServe/omni-reviewbot PR #56]

### 变更体量

- [REV-3b] 单个 PR 的非测试代码增量必须留在可审阅预算内
  - 触发：任何 PR 进入审查。
  - 强制：以 host 提供的确定性行数为准 —— 非测试文件的新增与修改行，删除不计。超过 1000 行时要求拆分计划，或写明豁免理由（上游 vendored 同步、生成代码），并点名贡献最大的文件。
  - 验收：审查记录写出非测试新增行数、预算和最大贡献文件。超预算时给出一条提醒级 finding，落在贡献最大的文件上；PR 描述已经给出拆分计划或豁免理由时记录该理由，不再重复开单。^[owner review-rule request 2026-09-10] ^[JiusiServe/omni-reviewbot PR #57]

## 决策与踩坑

- [REV-1a] 禁止：只按 changed files 或当前调用路径收口；把目录相邻直接当成同族证据；用一个变体的绿测证明其他变体不受影响。
- [REV-1b] 禁止：让默认配置或常用分支掩盖另一条路径；只测各分支“能运行”；用实现不同倒推语义必然不同。
- [REV-2a] 禁止：为 correctness 和 subtraction 各跑一篇通用审查；让不同 reviewer 重复读取同一文件、搜索 caller 或运行同一测试；分别发布多篇 review comment。
- [REV-2b] 禁止：把字段丢失、默认值错误等 correctness bug 算作减法；用删局部变量、改名、换文件或多 caller 证明设计已经最简；让后续 RFC slice 因为已写完而混入当前 PR。
- [REV-2c] 禁止：为了补齐外围 CI、全量测试、历史 thread 或额外专项无限延长；在 reviewer 已超时后继续无上限等待“完整结果”。
- [REV-3a] 禁止：把"跑过某个测试文件"当成该用例在 lane 内被执行的证据 —— marker 会把它 deselect；用 `timeout`、`--cov*`、容器或环境前缀的字面差异判定不一致；PR 完全没有测试证据时保持沉默。
- [REV-3b] 禁止：自己去数 diff 行数 —— patch 对大文件会被截断，而那正是超预算 PR 的常态；把体量本身当成正确性问题或用它抬高其他 finding 的严重度；把测试、文档、lock 文件和纯 rename 算进预算 —— 那会逼作者少写测试。
