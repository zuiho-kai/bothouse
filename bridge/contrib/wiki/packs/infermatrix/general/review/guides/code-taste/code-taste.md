---
name: code-taste
description: 写业务、测试、示例代码及 API 字段、CLI 参数、helper 前必读的代码品味硬规则：9 条硬标准、架构重置验收、下钻场景、owner 提示、触发词
metadata:
  scope: 只收写代码前的通用品味硬标准与架构重置门禁；API 面细则归 code-taste-api-surface，新执行路径与 diff 审查流程归 code-taste-review-flow
---
# Code Taste

## 现状

- **硬规则:** 凡是要写业务代码、测试代码、示例代码、API 字段、CLI 参数、helper 函数，动手前先读本页。

- 这不是多跑一个 pass。人工 reviewer 抓的是代码气味：名字误导、逻辑住错层、helper 重复、测试放错、注释没解释策略、API 面膨胀、diff 像临时补丁。测试通过只能证明这条路径没坏，不能证明代码有品味。

## 关键事实

- 源页：`knowledge/general/review/guides/code-taste.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 9 条硬标准

1. **命名说机制。** 名字必须说清控制对象和机制，且匹配 helper 抽象层级。不要用 `force_ratio`、`align_size`、`compat` 这种需要口头解释的名字。
2. **逻辑住 owner。** 看数据和语义长期归谁，不看哪个文件方便改。Resolution/bucket 归 processor，AR token 限制归 sampler/model executor，HTTP 字段透传归 serving/protocol。同一轮 review 中多个 finding 若都来自同一语义被多个入口、dispatcher 或 adapter 各自解析，必须把它们归并为一次 owner 边界失败：停止逐分支补丁，先定义唯一 owner 的输入和产物，再让各路径只消费该产物。
3. **新 helper 默认有罪。** 先 grep repo、upstream、AR/DiT 对侧实现和测试 fixture。写出 "mirrors X" 时，下一步是问为什么不复用 X。
4. **测试放行为 owner。** 测试文件要让 reviewer 一眼知道为什么在这里。只为了 import 方便而放到相邻 test，是错层。
5. **测试绑定当前 diff。** 每个新增测试必须对应 reviewer comment、当前 PR contract、明确 bug、或刚修复 diff 的最小 regression。答不出就删或移到 owner。
6. **注释解释策略。** 注释只解释 upstream 对齐、多分支选择、不变量、非显然边界；不要解释语法。
7. **diff 自带说服力。** 提交前按 [[reviewer-lens-gates-2]]（全量 diff 审查；源锚点 #full-diff-review） 确认真实基线、当前 tracked 改动和属于本任务的 untracked 文件。文件列表、命名、注释、测试位置、helper 复用、silent fallback 都要经得起第一眼 review。
8. **条件分支要有正反对照。** 新增或修改选择、过滤、拦截或路由条件时，必须从同一个对外或生产入口至少测一个“应进入”和一个“不应进入”的例子，并断言用户或系统能观察到的结果。两个输入结构相同但语义不同时尤其容易漏测；只测负路径会让“把整个功能禁用”也误绿。
9. **规模膨胀触发架构重置。** 非琐碎改动编码前记录生产代码的预期新增区间、准备删除或替换的旧块，以及唯一 owner 的最终产物；行数是架构报警器，不是越短越好的 KPI。实际生产新增超过预期上限的 1.5 倍、出现第二套语义重叠的 contract/compiler/normalizer/conflict formatter、同一字段在 global/stage 或多个 dispatcher 重复转换、或第二个 review 波次再次发现同一 owner 不变量遗漏时，立即冻结 diff，禁止继续添加特殊分支和逐 comment 测试。
   - 恢复编码前必须重新给出完整输入矩阵、唯一最终产物、准备删除的重复实现和新的规模上限；测试新增不计入生产预算，也不能抵消生产结构失控。

### 架构重置怎样验收

- 触发上面的重置门禁后，不能只把 helper 改名或把重复分支搬进另一个文件。重新实现完成时必须同时满足：

  - 报告最初预算、触发重置时的实际生产 diff、重构后的实际生产 diff和删除项；
  - 每类语义只有一个 owner 产物，下游只消费该产物，不再重新解析、合并或静默跳过字段；
  - 同类 reviewer finding 由一份输入/consumer 决策表统一关闭，不按评论数量增加条件分支；
  - 参数化测试从同一份决策表产生，并至少走到一个真实最终 consumer；测试数量和通过数量不能充当架构正确的证据。

### 写完不等于完成

- 非琐碎开发任务在作者自测后，还必须进入 [[agent-loop-workflow-2]]（开发交付的维护者审查闭环；源锚点 #开发交付的维护者审查闭环）。作者不能用“自审 0 finding”代替独立 reviewer；修复 finding 后也不能只验旧问题，必须重审当前完整 diff。

### 需要下钻的场景

- 新增 CLI/API/config/`extra_args`/`mm_processor_kwargs`/multimodal key/bridge 字段，或新增 optional fast-path 参数：读 [[code-taste-api-surface]]（code_taste_api_surface）。
- 新 execution path 复用 request parsing、改 shared state/schema、处理 inline review、准备 push 前模拟人工 reviewer：读 [[code-taste-review-flow]]（code_taste_review_flow）。
- 需要 sub-agent 或 push 前四项 reviewer-lens audit：读 [[reviewer-lens-audit-1]]（reviewer_lens_audit）。

### 常见 owner 提示

- serving/chat shared path 只保留用户 payload 语义，不把单个模型的 multimodal key 规则推广为全局规则。
- consumer 不 hardcode producer 的 enum / token range / valid values。
- 如果要把数据搬出去才能算，通常逻辑放错层。把逻辑搬到数据 owner，而不是复制数据。
- 新建 dedicated owner test 文件比污染相邻 test 更好。

### 触发词

- 用户说这些话，下一次写代码前必须更认真读本页和下钻页：

  - "代码品味"
  - "人工 reviewer"
  - "为什么会被发现那么多问题"
  - "以后写代码必须看"
  - "不要只是能跑"
  - "像补丁"

## 决策与踩坑

### 写前先停一下

- 如果脑子里出现这些句子，先停：

  - "先放这里吧"
  - "这个名字差不多"
  - "测试放这里也能跑"
  - "复制一份最省事"
  - "reviewer 应该能看懂"
  - "这个参数以后可能有用"
