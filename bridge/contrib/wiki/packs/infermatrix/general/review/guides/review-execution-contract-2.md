---
name: review-execution-contract-2
description: 独立审查执行合同（2/3）：解释压力反查、触发式减法合同、用户可见输出与 subtraction_signal 提交、Source-consumer decision matrix、Reviewer 只读输入、Owner 审查组声明
metadata:
  scope: 只收独立审查执行合同的减法合同、对外输出格式、来源 × consumer 决策矩阵、reviewer 输入与 owner 审查组表；审查流程与完成条件见 review-execution-contract-1，内部审计模板与机器检查见 review-execution-contract-3
---
# 独立审查执行合同（2/3）

## 现状

- 本页是源页的第 2 部分，接 [[review-execution-contract-1]]（何时使用、单次输入、60 秒渐进状态、Direct 并行、完成条件、默认一次审查），后续见 [[review-execution-contract-3]]（内部审计 Markdown、机器检查、何时继续读取详细指南）。

## 关键事实

- 源页：`knowledge/general/review/guides/review-execution-contract.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-13；updated: 2026-10-02
- 来源（sources）见 [[review-execution-contract-1]]：InferMatrixCopilot Issue #17；InferMatrixCopilot Issue #24；vllm-project/vllm-omni PR #5871；zuiho-kai/claude-workflow-starter@c217fc6

### 解释压力反查

- 减法信号触发后，减法轮必须用最终 head 做一次不依赖历史的人话解释：只说输入、每个 source × scope 的唯一 owner 产物和最终 consumer。
- 若必须靠修复时间线说明结构，检查：
  - 两个字段组、helper 或中间对象没有不同 consumer，最终只是立即合并、转发或拆后再合；
  - 同一 owner 产物跨层不断换名，尤其把已校验 projection 又叫回 raw request 或 kwargs；
  - normalizer 已产出最终值，下游仍重读原始输入、补 default、重做 alias 或 precedence；
  - 当前 RFC slice 明确不拥有的职责，production diff 却修改了其真实 consumer。
- 命中后写出“当前结构 → 最小结构 → 具体删除或迁移项”。
- 只有 representation、lifecycle 或 failure policy 不同才允许额外层；“兼容复杂”“测试很多”不是证明。

### 触发式减法合同

- 先检查 diff 是否新增或扩张以下任一信号：
  - helper 或 class；
  - fallback 或兼容分支；
  - 对外 API、CLI、配置、默认值等公共行为。
- 没有信号时标记 `subtraction_signal=none`，不要求 scope ledger、abstraction census 或完整最小性证明。
- 命中任一信号时标记 `subtraction_signal=triggered`，再做 scope subtraction 和 architecture subtraction，并在内部审计中交付：
  1. **Scope ledger：** 每个新增 behavior、production 文件和测试组映射到当前目标或 RFC slice；无法映射就 `DELETE / DEFER`。
  2. **当前 census：** 枚举保留范围内新增或扩张的 helper、class、field group、allowlist、owner projection、跨层 artifact 和末端补偿。
  3. **最小设计：** 在保持 scope 外 base 行为不变时，写出最少 owner artifact、transformation 和 consumer。
  4. **逐项账本：** 对 census 每项标记 `KEEP / INLINE / MERGE / MOVE / DELETE` 并给代码锚点；改名、换文件、删临时变量不算减法。
  5. **净结果：** 分别报告 scope 删除项，以及 abstraction、owner、重复 projection、末端补偿和 production branch 的净减少。
- correctness bug 不算减法。
- 减法 `PASS` 必须给可执行的删/并/内联方案，或用完整 ledger 证明授权 scope 和 census 已经最小。

### 用户可见输出

- 默认输出必须像正常 GitHub code review，而不是合规报告：
  1. 每个 pinned head 只发布一篇合并后的 review comment；专项结果回到主审查，不能各发一篇。渐进状态留在宿主对话或状态流，除非用户明确要求，不发布“初稿评论 + 最终评论”。
  2. 每个 finding 绑定精确 `path:line` 或 diff hunk。
  3. 正文依次说清具体触发输入/调用路径、当前行为、为什么有风险、最小修复方向。
  4. 不显示规则 ID、覆盖表、入口矩阵、`PASS`、`MISSING_EVIDENCE` 或 `Disposition`；这些只在用户明确要求完整审计产物时附上。
  5. 只有减法信号触发时，才给出具体 scope/architecture 减法；普通小修不需要单独写减法或最小性证明。
  6. 没有 actionable finding 时只简短说明没有发现问题，并指出真正影响结论的验证缺口。
- 规则用于帮助 reviewer 找到问题和防止漏检，不能成为用户自己翻译的输出格式。
- Direct MCP 提供完成检查工具时，最终评论前先提交 `subtraction_signal`：
  - `none`：本 diff 没有新增或扩张 helper、class、fallback、兼容分支或公共行为，不需要额外证明；
  - `triggered`：必须继续提交以下二选一结构：
    - `subtraction`: 每项包含具体代码锚点、`DELETE / DEFER / INLINE / MERGE / MOVE` 动作和风险；
    - `minimality_proof`: 包含 scope ledger 结论、abstraction census 结论，以及为什么没有安全删除项。
- 未分类时返回 `partial_review`。
- 只有 `triggered` 且两类证据都缺失时，才复用现有证据补一次有界减法检查后重新验证。
- 普通小修不能被迫写完整最小性证明，也不允许因此产生第二篇评论。

#### Source-consumer decision matrix

- 同一用户语义如果有多个输入来源、dispatcher、stage 类型或兼容入口，覆盖轮还必须先写完**来源 × consumer scope 决策矩阵**，再读具体实现。
- 每个 source/scope 单元格只能标成：路由到哪个 consumer、与哪些来源重复时拒绝、明确不适用，或非用户 default；不能留给字典合并顺序和分支先后隐式决定。
- 至少验证每个合法单来源、每组同 scope 重复、一个跨 scope 共存 control，以及每条 production dispatcher 的等价结果。
- 矩阵缺失时，即使当前测试和开放轮没有 finding，也只能报 `partial review`。
- PR 声称“严格校验”“拒绝未知字段”“统一 normalization”或其他全入口行为时，公开入口不能只按 changed hunk 或当前 production caller 枚举。
- 必须搜索同一合同的所有可调用 constructor、factory、classmethod、兼容 helper 和旧入口，包括本次未修改、已退出当前主调用链但仍可被仓库测试或外部调用者直接使用的入口；对每个入口运行同一个最小负向样例并记录结果。
- 任一入口仍静默接受、过滤或覆盖该样例时，整体合同未闭环；如果宽松行为确属兼容要求，必须有明确文档、专门回归测试和不把它算作严格入口的 scope 声明。
- 只证明两条 production 路径严格，不能据此宣称整个配置或 API surface 已严格化。

### Reviewer 只读输入

- 用户需求和允许修改的范围；
- 固定的 target/base SHA；
- 当前完整 diff，以及属于任务的未跟踪文件；
- [[review-rules]]（通用设计审查规则）及当前 diff 命中的结构触发；
- live 调用链证明的 owner `rules.md`；
- 每个 owner 的规则组选择及触发理由；有触发组时必须包含 `core`，选择错误由主 agent 复核，checker 只验证组内覆盖完整；
- 编码前已存在的 mini spec 或合同矩阵；不存在时记 `MISSING_EVIDENCE`，不能事后代写；
- 必要的仓库源码、测试和官方实现。

### Owner 怎样声明审查组

- 小 owner 可以不分组，继续全量审计。
- 规则较多时，在 `rules.md` 放一张人能直接编辑的表；一旦使用分组，必须有 `core`，每个稳定 ID 至少属于一个组，组名只用小写字母、数字和连字符。
- 开发路由规则可以放 `author-routing`，不要塞进每次代码 review 的 `core`。

```markdown
| 审查组 | 什么时候触发 | 规则 ID |
|---|---|---|
| `core` | 每次代码审查 | `ABC-1a`, `ABC-1b` |
| `public-topology` | CLI、API、资源获取或 topology 改动 | `ABC-2a`, `ABC-2b` |
```

- 第三方新增 owner 时只需手工增加同样的表和稳定 ID；checker 会验证组名、`core`、未分组 ID、未知 ID 和报告里的组内覆盖，但不会替人判断触发条件是否写得合理。

## 决策与踩坑

- （Reviewer 只读输入）不要给 reviewer 作者自评、怀疑根因、历史 reviewer 答案或 incidents。
- （Reviewer 只读输入）规则直接指向 owner 后停止读其他文档，但**停止读文档不等于停止追源码**：必须继续覆盖所有能到达同一 consumer 的公开入口和跨 owner 调用边界。
