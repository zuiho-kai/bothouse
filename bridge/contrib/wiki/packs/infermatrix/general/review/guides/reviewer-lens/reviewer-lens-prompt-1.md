---
name: reviewer-lens-prompt-1
description: Reviewer Lens Prompt 第 1 部分：只读 review sub-agent 的可粘贴 prompt 前半（scope stop、owner 规则清点、risk tags、Audit 1-4 duplication/layering/edge cases/surface area）
metadata:
  scope: 只收 reviewer-lens spawn prompt 代码块的前半（开头到 Audit 4）；conditional audits、finding 返回格式、尾签和 owner prompts 见 reviewer-lens-prompt-2
---
# Reviewer Lens Prompt（1/2）

## 现状

- Use this when spawning a read-only review sub-agent. Do not add a suspected root cause unless the task is explicitly finding-closure for an already accepted finding.

- 正常独立审查先执行 [[review-execution-contract-1]]（review execution contract），并使用其固定 Markdown 报告和检查脚本。本页是需要完整风险 lens 或专项 owner prompt 时才追加的详细 prompt；只返回本页末尾两行、不交付执行合同中的两张矩阵，仍是 partial review。

- 本页是源页的第 1/2 部分；续页 [[reviewer-lens-prompt-2]]（prompt 后半：Conditional audits、finding 返回格式与尾签；Owner prompts；Specialist owner prompts）。

## 关键事实

- 源页：`knowledge/general/review/guides/reviewer-lens-prompt.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-23；sources: 无
- 下面的 prompt 在源页是同一个 `text` 代码块（源页第 16–190 行），因页长限制在 Audit 4 之后断开；粘贴使用时把本页代码块与 [[reviewer-lens-prompt-2]] 的第一个代码块按顺序拼接，两块之间保留一个空行（与源页一致）。
- 上文“本页末尾两行”是源页原话；源页末尾的 prompt 结尾部分现位于 [[reviewer-lens-prompt-2]] 的第一个代码块末尾。

```text
Static review this PR/diff/change. Do not stop after the first valid finding.
First classify the change by risk type, then audit every selected risk type.

Scope stop: once the frozen base, complete diff including in-scope untracked
files, and owner chain are verified, stop navigation. Do not recursively read
unrelated owners, incidents, or history. Read contribution/layout rules only
when the diff changes the knowledge tree. Add each additional owner only when
the live producer-consumer trace crosses that boundary.

For every owner in that proven chain, read its existing rules.md if present.
When that owner defines review groups, select `core` plus every group triggered
by the current diff and reachable paths, then inventory every stable constraint
ID in those groups. Only owners without review groups require a full-page ID
inventory. Mark each selected ID PASS / FAIL / MISSING_EVIDENCE /
NOT_APPLICABLE with file/function/test/run evidence. N/A also needs evidence;
omission cannot produce a clean result. Group/namespace headings do not count
as IDs. For an ID with a fixed evidence matrix, report every triggered row; one
missing row prevents PASS. When an old rules
page has no stable sub-IDs, treat each bullet or prose paragraph as one source
unit, quote it, and list every normative requirement you identify inside it.
Report that page as legacy-unstructured; do not claim exact clause coverage or
try to infer cardinality from keywords. If the current diff materially edits
that rule, require stable IDs under the contribution rules. If no owner rules.md exists, write
"OWNER RULES: none" and continue. Do not search incidents/history to invent
hidden rules. Novel findings do not offset a missed owner invariant.

Return all matching risk tags with one file/function evidence each:
- public API / user-facing contract
- module semantic contract
- cross-module producer-consumer contract
- async / concurrency / scheduling
- resource lifetime / cleanup
- data format / serialization / IPC
- performance claim / benchmark evidence
- error handling / cancellation / timeout
- feature flag / config / default behavior
- backward compatibility
- test or validation evidence

Then list selected review lenses. For EACH of the four base audits below,
return findings (P0 blocker / P1 should-fix / P2 low-severity substantive issue)
OR explicitly write
"none found" — do not skip any audit and do not pre-focus on one over another.

Pure style preferences that do not affect behavior, maintainability, contract,
or evidence are `nit`, not P2, and do not block a clean verdict.

# Audit 1 — Duplication
Grep both the repo (project source dirs, scripts, tests, docs as applicable) and
any upstream/reference implementation for functions / classes / algorithms /
constants that overlap with anything new in this PR. List each match with:
  - file:line of the existing implementation
  - file:line of the new implementation
  - 1-line judgment: should reuse / cannot reuse + why

# Audit 2 — Layering
For each new piece of logic, identify which module persistently holds the data
it operates on. If logic and data live in different modules, list:
  - new logic location
  - data owner location
  - proposed correct home

# Audit 3 — Edge cases
List every range / boundary / default value the new code touches. For each,
name which branches handle:
  - empty / single-element / max-size extremes
  - non-contiguous ID ranges, off-by-one
  - None vs 0 vs sentinel
  - feature-flag matrix and old/new execution modes
Flag any boundary not explicitly handled.
For every added or changed selector, filter, guard, or routing predicate, verify
through the same public or production entry point at least one case that should
enter and one that should not enter, including each observable result. Flag a
test suite that still passes when the selected behavior is disabled entirely.

# Audit 4 — Surface area
List every new public knob (CLI arg / API field / extra_args key / config
option / public function / SSE or OpenAI-compatible response chunk). For each:
  - If this is a request parameter, extra_body/extra_args key, processor kwarg,
    multimodal key, or cross-module bridge field, provide a contract matrix:
    ingress path(s), allowed value shapes, normalization point, owner module,
    downstream consumer(s), no-op cases, docs, and tests.
  - Can it be derived from existing knobs? If yes, why expose it?
  - Why is the default what it is? Can the help text be shorter?
  - Is the same value also expressible via another path?
  - If this is a public API field or response schema, where is the protocol type
    defined, where is it documented, and what bad-path tests cover it?
  - If this is streaming/SSE/WebSocket, which existing endpoint pattern and
    output-processor mechanism does it reuse?
  - If this is an internal optional fast-path parameter, what are its data
    contract and execution-context contract, and where does a wrong caller fail?
  - If this changes a shared state/schema type, list every constructor, unpack
    site, and consumer found by grep, and state how positional arity remains
    compatible.
Flag knobs that are accreted/over-defensive.
```
