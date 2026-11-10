---
name: agent-loop-workflow-2
description: Agent loop / sub-agent workflow（第 2/2 部分）：开发阶段耗时记录、框架规则迭代怎么验收、开发交付的维护者审查闭环（反证扫描与审查步骤）、停止条件
metadata:
  scope: 只收开发阶段耗时记录、框架规则迭代验收、交付前维护者审查闭环和收回主线程的停止条件；是否拆 agent、委派合同、所有权与审查波次归 agent-loop-workflow-1，审查执行步骤归 review-execution-contract-1
---
# Agent loop / sub-agent workflow（第 2/2 部分）

## 关键事实

- 源页：`knowledge/general/agents/guides/agent-loop-workflow.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, agents；created: 2026-07-10；updated: 2026-07-30
- 来源（sources）："InferMatrixCopilot Issue #24"、"zuiho-kai/claude-workflow-starter@c217fc6"
- 本页是源页 `agent-loop-workflow.md` 的后半部分（“开发阶段耗时记录”到“停止条件”）；前半部分（“何时来翻”“是否使用”到“所有权与证据”）在 [[agent-loop-workflow-1]]。

### 开发阶段耗时记录

- 非琐碎开发和框架效率实验使用实际时钟记录下面八个时间点：

```text
任务开始：
owner 锁定：
首次有效代码、测试或目标文档落盘：
首次目标测试：
开发完成（`AUTHOR_COMPLETE`，reviewer 启动前）：
独立 review 开始：
独立 review 完成：
最终完成：
```

- 报告时分别计算路由、编码、验证、review 等待、review 执行和 review 修复时间，不只给一个总耗时。
- 纯开发时间固定截止 `AUTHOR_COMPLETE`；reviewer 排队、spawn、读取和审查不得混入开发分母，review 后没有代码变化时也不能重写这个时间点。
- 没有可靠时间戳的阶段写 `unknown`，不能根据文件数量或聊天体感补时间。
- TODO、注释、纯格式、占位测试和空骨架不记为首次有效落盘。
- owner 已锁定且 live source 可读时，开发 agent 不为“更完整地了解仓库”继续横向读文档；五分钟首次落盘门禁和允许扩展的阻塞条件见根 `CLAUDE.md`。

### 框架规则迭代怎么验收

- 因为一次 AI 漏检而修改本框架时，发布前至少重跑同一个冻结任务和一个不同类型的 control；不能只证明新增规则会背出已知答案。实验开始前固定基线、任务输入、允许知识和评分表，并分别报告：首次有效落盘、开发时间、review 时间、真实问题召回、错误 P1、默认路径回归和端到端时间。
- 最低目标是首次有效落盘不超过五分钟、窄 bug 开发时间不比同模型裸基线慢超过 15%、错误 P1 为零，并且 control 不劣化。没有裸基线时只报告绝对时间，不编造提升比例。提高检查项数量或报告长度不算正确率提升；只有更早发现真实问题且不新增错误 blocker 才算优化有效。

### 开发交付的维护者审查闭环

- 适用于非琐碎的业务代码、测试、公开接口、配置、CLI 或模型适配。目标不是让 reviewer 说句“看起来可以”，而是在交给真实 maintainer 前消掉会阻止合并的问题。
- 窄 bug 先完成一个十五分钟内的生产纵向切片：前三分钟锁 owner、复现和官方入口，随后约七分钟修改真实 owner 路径，再留三分钟跑最小目标测试和默认或相邻 control，最后两分钟做反证扫描。
  - 先证明生产影响面，再扩测试；同一种语义在多个模块重复时只选代表 consumer 测试，不按模块数量堆矩阵。
  - 十五分钟是首个可验证切片的上限，不是复杂任务的总预算；只有真实运行或对齐证据仍有残余差异，才进入对应的 compatibility、precision、runtime 或 remote 组继续调查。
- 开发 agent 在交给独立 reviewer 前，窄 bug 留两分钟、高风险任务最多四分钟做一次**反证扫描**。这不是再读一轮规则或 review guide，只沿当前 diff 和已经打开的 live source 找会推翻“可以交付”的证据：

1. **公开入口：** 列出受影响行为的真实 dispatcher，确认每条入口都在 decode、load、网络或 GPU 等昂贵操作前执行同一 owner 合同；不能用一个 helper 被另一条入口调用来代替。
2. **精确 consumer 反查：** diff 改变共享字段的类型、默认值、sentinel 或“是否提供”语义时，只取 diff 中真实改变的字段名，在生产代码内做最多两次、总计不超过九十秒的精确引用搜索；只检查赋默认值、truthiness、fallback、alias 和已注册 consumer。
   - 命中其他模块不触发文档或规则扩读，确认需要修改时才打开源码。局部实现或搜索没有新 consumer 时立即停止，不能扩大成全仓库审计。
3. **数量和形状：** 把最小、最大、超界以及一个异构/ragged 样例走到第一处 `stack`、`concat`、索引或 batch reshape；只测 helper 的数量判断不算完成。
4. **阶段状态：** 涉及多阶段或 online/offline 时，逐阶段核对 seed、sampling、system/task 和中间产物没有在 dispatcher 或 adapter 处丢失。
5. **不受影响路径：** 修改 shared serving、协议或通用 adapter 时，至少跟一条其他 owner 或 legacy fallback 从入口走到旧 consumer，证明新列表、默认值和错误处理没有改变它。

- 精确 consumer 反查必须在扩充测试矩阵前完成。扫描发现问题就先修再自测；时间到点仍有关键链路未知时，把具体未知量标为 `implementation draft` 交给 reviewer，不能用更多搜索、stub、lint、compile 或“另一条入口正常”冒充完成。
- 反证扫描结果不喂给盲审 reviewer；reviewer 仍从任务合同、owner 规则和完整 diff 独立判断。

1. 开发 agent 完成实现、目标测试和自审，记录 `AUTHOR_COMPLETE`，但此时只能说“待独立审查”。父 agent 默认负责安排审查；开发 sub-agent 返回交接后停止，不自行嵌套 reviewer。
2. 审查负责人安排一次没参与设计和编码的主审查。
   - 主 reviewer 只读用户要求、基线、当前完整 diff、绑定当前基线的 canonical mini spec/编码前 contract matrix，以及由 PR 描述和 changed files 一次性解析出的 `owner/model → 规则组 → 第一批源码` 路由包。
   - 记录不存在时明确报 `MISSING_EVIDENCE`，不能在 review 阶段代写；incidents/history 不作为默认输入。
   - 主审查在同一份报告里完成 correctness 与 design/subtraction，并持续复用已读文件、caller 搜索、测试和 findings。只有它留下具体的高风险未知量时，审查负责人才能委派一个有边界的只读专项；专项结果回到主 reviewer，不得生成第二篇通用报告或公开评论。
3. reviewer 按 [[review-execution-contract-1]]（独立审查执行合同，源 `../../review/guides/review-execution-contract.md`）完成覆盖、减法和开放三轮审查：owner 定义触发组时先选择 `core` 加当前 diff 命中的组并完整枚举组内稳定 ID；没有组时才全量枚举该 owner。
   - 逐条判定 `PASS / FAIL / MISSING_EVIDENCE / NOT_APPLICABLE`，填写当前可达入口和 changed-value producer→consumer 表，再按 [[reviewer-lens-gates-2]]（全量 diff 审查，源 `../../review/guides/reviewer-lens-gates.md#full-diff-review`）查 duplication、layering、edge cases 和 surface area。
   - 新的 blocking finding 必须完成 `DIFF / PATH / CONTRACT / FAILURE / COUNTEREVIDENCE / FIX` 六项证明；证据不足的架构怀疑写调查 note，不能用来制造 `FAIL`。
4. 语气可以像强硬的项目 owner：直接、不放水、不接受假证据；但只评代码和证据，不攻击人。
5. 原开发者在原实现工作区修复 P0/P1/P2；写入 agent 继续遵守已约定的隔离目录、worktree 或文件所有权边界。P2 表示低严重度但仍需修复的实质问题；纯样式 nit 单列且不阻止完成，不能把维护问题降级成 nit。
6. 修复后由 reviewer 重新审查当前完整 diff，既检查旧 finding 是否真正关闭，也查修复引入的新问题。只关闭旧问题不等于全量复审。
7. 审查负责人把 reviewer 输出保存为 Markdown，并按执行合同运行 `python tools/check_review_report.py --report <review.md> --rules <stable-owner-rules.md> --legacy-rules <legacy-owner-rules.md>`；checker 验证所选触发组及组内覆盖，审查负责人仍要核对组是否选对、finding 六项证据是否真实。
   - 最终交付再加 `--require-clean`。只有结构通过、所选规则 `0 FAIL / 0 MISSING_EVIDENCE` 且开放审查 `0 P0 / 0 P1 / 0 P2` 才能完成。
   - 正式测试被依赖、模型、硬件或环境阻塞且没有等价证据时，才标记 `implementation draft`；不能用 lint、compile、mock 冒充行为证据。

- 审查 prompt 的通用维度见 [[reviewer-lens-prompt-1]]（reviewer lens prompt，源 `../../review/guides/reviewer-lens-prompt.md`），如何避免把作者偏见传给 reviewer 见 [[review-delegation-framing]]（review delegation）。
- 当前环境没有独立 agent 能力时，仍要按同一维度做一次新鲜全 diff 自审，并明确报告“未经独立 reviewer”；不能声称已经通过独立维护者审查。无论是否有专项能力，对外都只发布一篇合并后的 review comment。

## 决策与踩坑

### 停止条件

- 出现以下任一情况就收回主线程判断：
  - 证据互相冲突。
  - 子任务开始依赖未验证的前置结论。
  - 多个 agent 触碰同一写入面。
  - 连续尝试没有产生新证据。
  - 继续推进需要用户授权或会扩大任务范围。
- 长跑、远端 GPU、benchmark 的预算和 watchdog 仍由对应场景 runbook 管理，不在这里重复定义。
