---
name: reviewer-lens-audit-1
description: Reviewer-lens audit 第 1 部分：为什么、先分类再审（risk tags）、先审已知不变量（owner rule audit）、无效 prompt、必跑四项、什么时候升级
metadata:
  scope: 只收一次主审查必须审什么的方法前半（分类、owner 规则审计、四项基础 audit、升级条件）；输出格式、适用方式、反模式见 reviewer-lens-audit-2
---
# Reviewer-lens audit（1/2）

## 现状

- 本页是源页的第 1/2 部分；续页 [[reviewer-lens-audit-2]]（输出格式、适用方式、反模式、历史案例、链接）。
- **Why:** PR #3626 证明普通 "code check" 护不住 review：sub-agent 说 OK，但 reviewer 仍抓到重复算法、错层、非连续 token id 和冗余 surface。Reviewer-lens 的目的不是让 sub-agent 拍板，而是把 reviewer 会看的维度显式化。

- 需要立即执行独立审查时先用短入口 [[review-execution-contract-1]]（独立审查执行合同）。本页解释审查方法，不能替代执行合同要求的覆盖报告和机器检查。

- 派生自 [[review-delegation-framing]]（review_delegation_framing）：那条管专项问题怎么委派，这条管一次主审查必须审什么。

## 关键事实

- 源页：`knowledge/general/review/guides/reviewer-lens-audit.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-30
- 来源（sources）：InferMatrixCopilot Issue #24

### 先分类再审

- 不要先找 bug。先判断这个改动改变了哪类工程系统性质，再决定要跑哪些 lens。最少输出这些字段：

```text
Review risk tags:
- public API / user-facing contract:
- module semantic contract:
- cross-module producer-consumer contract:
- async / concurrency / scheduling:
- resource lifetime / cleanup:
- data format / serialization / IPC:
- performance claim / benchmark evidence:
- error handling / cancellation / timeout:
- feature flag / config / default behavior:
- backward compatibility:
- test or validation evidence:
Selected lenses:
```

### 先审已知不变量，再开放找问题

- 先确认主要 owner；只有 live producer-consumer trace 证明 diff 跨越其他 owner 边界时，才沿调用链增加 owner。owner 定义审查触发组时，只建立 `core` 加当前 diff 命中组的稳定 ID 清单；没有组时才全页枚举。组内每个 ID 都输出 `PASS / FAIL / MISSING_EVIDENCE / NOT_APPLICABLE` 和证据，未触发组不靠几十行 `NOT_APPLICABLE` 制造完整感。

- 旧规则没有稳定子 ID 时，以每个项目符号或普通段落作为 source unit，原文引用后逐项列出其中识别到的规范性要求，尾签标成 `legacy-unstructured`。这种页面可以完成审查，但不能声称精确 clause coverage；实质修改该规则时应先按贡献规范补 ID。不能运行时靠关键词解析自然语言总数。

- 没有 owner `rules.md` 时明确写 `OWNER RULES: none`，继续执行 contract 和开放审查；不能自行读取 incidents/history 来猜规则。尾签中每个 owner 的已审条数必须等于所选触发组去重后的规则数；未定义组时才等于整页稳定 ID 总数。

- 这一步和开放式 finding 是两轮：第一轮防止已经沉淀的错误复发，第二轮再找规则之外的新问题。找到很多新 P1 不能抵消已知不变量漏审。

```text
OWNER RULE AUDIT:
- <owner path> <rule id or quoted legacy unit>: PASS | FAIL | MISSING_EVIDENCE | NOT_APPLICABLE — <evidence>
```

- 命中 async / concurrency / scheduler / thread / process / IPC / shared memory / socket / file / cache / GPU-CPU transfer / pinned memory / lock / resource lifetime / performance claim 时，基础四项不够，主审查必须加入对应 systems/runtime 或 evidence 检查。只有共享证据仍留下具体高风险未知量时才委派专项，不因命中标签自动再跑一篇审查。
- 没写 risk tags 和 selected lenses，只能叫 partial review。

### 必跑四项

- 每次 push 前、第一次 Codex review 中、准备把 PR 交给 reviewer 前，至少审这四项：

  1. **Duplication:** 新函数 / class / 算法 / 常量是否已有 in-repo 或 upstream 实现。
  2. **Layering:** 逻辑是否住在拥有数据和语义的 owner 模块。
  3. **Edge cases:** range、边界、默认值、状态矩阵、real checkpoint edge 是否被覆盖。
  4. **Surface area:** 新 public knob / API field / extra_args / schema / streaming protocol 是否真的必要，contract 是否完整。

- 新增或修改选择、过滤、拦截或路由条件时，Edge cases 必须从同一个对外或生产入口包含至少一个“应进入”和一个“不应进入”的对照，并检查两边可观察的结果。两个输入结构相同但语义不同时尤其要查；如果整个功能被禁用仍能让测试通过，就是实质性 finding。

- P2 表示低严重度但仍需修复的实质问题。纯样式、不影响行为、可维护性和证据的建议单独标为 `nit`，不计入 P2。

- 需要对未覆盖高风险合同做专项追问时，可裁剪使用 [[reviewer-lens-prompt-1]]（reviewer_lens_prompt）；不能把完整模板再跑成第二篇通用审查。

### 什么时候升级

- 下列场景不能只跑基础四项：

  - 新模型 / 新 pipeline / 新 backend：语义 owner 查官方 parity，integration owner 查 topology、默认入口和 unaffected control，见 [[reviewer-lens-gates-1]]（reviewer_lens_gates）。
  - 新 public API、`extra_args`、`mm_processor_kwargs`、multimodal bridge：先写 contract matrix，见 [[reviewer-lens-contracts]]（reviewer_lens_contracts）。
  - streaming / SSE / WebSocket / OpenAI-compatible schema：按 public protocol surface 审，见 [[reviewer-lens-contracts]]（reviewer_lens_contracts）。
  - async / concurrency / scheduler / IPC / resource lifetime / GPU-CPU transfer / performance claim：加跑 systems/runtime owner 和 evidence/benchmark auditor，见 [[reviewer-lens-gates-1]]（reviewer_lens_gates）。
  - full diff review、rebase、inline review 处理、fix 后复审：见 [[reviewer-lens-gates-1]]（reviewer_lens_gates）。
  - 另一个 Codex / bot / reviewer 能在我写出的 diff 里集中发现多个问题：按 authoring-time self-review failure 处理，写代码过程中跑 authoring-time delta audit，见 [[reviewer-lens-gates-1]]（reviewer_lens_gates）。

## 决策与踩坑

### 先别这样问

- 这些 prompt 默认无效：

  - "帮我 code check 一下"
  - "看有没有问题"
  - "review 一下这个 PR / commit / 改动"
  - "static review 看下"
  - "扫一遍" / "审一下"
  - "确认一下没问题"

- **原因:** 子 agent 只回答 prompt 框定的问题。没给 audit 维度，它没有判断 "出问题" 的标尺。
