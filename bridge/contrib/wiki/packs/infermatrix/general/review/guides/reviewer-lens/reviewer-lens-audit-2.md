---
name: reviewer-lens-audit-2
description: Reviewer-lens audit 第 2 部分：finding 输出格式与结尾尾签、自审与 sub-agent 及条件专项追问的适用方式、反模式、历史案例与相关链接
metadata:
  scope: 只收 reviewer-lens audit 的输出格式、适用方式、反模式和链接；分类、owner 规则审计、必跑四项、升级条件见 reviewer-lens-audit-1
---
# Reviewer-lens audit（2/2）

## 现状

- 本页是源页的第 2/2 部分；前页 [[reviewer-lens-audit-1]]（为什么、先分类再审、先审已知不变量、必跑四项、什么时候升级）。

## 关键事实

- 源页：`knowledge/general/review/guides/reviewer-lens-audit.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-30
- 来源（sources）：InferMatrixCopilot Issue #24

### 输出格式

- 每条 finding 必须先说人话：

  1. 会发生什么坏事。
  2. 为什么这是当前 PR 要管的事。
  3. 最小收口是什么。

- 禁止只写 `contract` / `ABI` / `surface area` / `state matrix`。这些词只能当括号里的精确标签，前面必须有具体行为例子。

- 结尾必须写：

```text
OWNER RULE GROUPS: <grouped path>: core,<triggered groups>
OWNER RULE COVERAGE:
- <path or none>: X/Y selected stable IDs inventoried — A pass / B fail / C missing evidence / D not applicable
- <legacy path>: X source units inventoried — A pass / B fail / C missing evidence / D not applicable — legacy-unstructured, no exact clause-coverage claim
AUDITS RUN: coverage,ingress,producer-consumer,duplication,layering,edge-cases,surface-area — N findings (Pa P0, Pb P1, Pc P2)
```

- 缺这个尾签，就当 audit 没跑完。

### 适用方式

- **自审:** push 前逐条写 review note，不要心算 "应该没问题"。

- **Sub-agent review:** 用 [[reviewer-lens-prompt-1]]（reviewer_lens_prompt） 的完整模板，不要把自己的怀疑原因塞进去。

- **条件专项追问：** 主 Codex review 已复用同一份文件、caller、测试和 finding 证据后，仍出现新颖、证据矛盾或未覆盖的高风险合同时，才把这个合同作为一个只读专项问题委派。例如只问 tokenizer/checkpoint parity，或只问默认 CLI 与真实 topology 是否一致。

- 专项使用相同基线、diff、owner 规则组和共享证据包，只补回答该问题必需的新证据；不能再做宽泛 producer-consumer 扫描，不能独立输出 verdict 或公开评论。主审查复核增量证据后合入唯一报告。

### 历史案例

- 精简案例索引见 [[reviewer-lens-cases]]（reviewer_lens_cases）。

### 链接

- [[reviewer-lens-prompt-1]]（reviewer_lens_prompt）
- [[reviewer-lens-gates-1]]（reviewer_lens_gates）
- [[reviewer-lens-contracts]]（reviewer_lens_contracts）
- [[reviewer-lens-cases]]（reviewer_lens_cases）
- [[review-delegation-framing]]（review_delegation_framing）
- [[upstream-first-for-algorithm]]（upstream_first_for_algorithm）
- [[codex-review-lessons]]（codex_review_lessons）

## 决策与踩坑

### 反模式

- "sub-agent 说 OK 我就 push 了"。
- 只 grep 仓库或 upstream 其中一边。
- 把 audit 当可选 thoroughness。
- commit message 写了 trade-off，但没写边界条件。
- 修完 finding 后不复审新增 diff。
