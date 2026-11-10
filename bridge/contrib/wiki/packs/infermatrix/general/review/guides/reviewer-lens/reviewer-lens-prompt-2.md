---
name: reviewer-lens-prompt-2
description: Reviewer Lens Prompt 第 2 部分：可粘贴 prompt 后半（conditional audits：ingress、path matrix、resource lifecycle、evidence/benchmark；finding 格式与尾签）及 Role A-D owner prompts
metadata:
  scope: 只收 reviewer-lens spawn prompt 代码块的后半（conditional audits 到尾签）和 owner / specialist owner prompts；prompt 前半见 reviewer-lens-prompt-1
---
# Reviewer Lens Prompt（2/2）

## 现状

- 本页是源页的第 2/2 部分；前页 [[reviewer-lens-prompt-1]]（使用说明与 prompt 前半：开头到 Audit 4）。

## 关键事实

- 源页：`knowledge/general/review/guides/reviewer-lens-prompt.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-23；sources: 无
- 下面第一个代码块是源页同一个 `text` 代码块的后半（接在 [[reviewer-lens-prompt-1]] 的代码块之后，Audit 4 的 `Flag knobs that are accreted/over-defensive.` 与本块首行之间在源页有一个空行）。
- 源页该代码块中以 `"OWNER RULE COVERAGE: <path or none>` 开头的一行超过 300 字符，本页在两个引号字符串之间的 `or` 之后折成两行，文字未改；粘贴时可合回一行。

```text
# Conditional audit — Public ingress and producer-consumer behavior
Run this for public API, CLI/example, multimodal input, request normalization,
or cross-stage handoff changes. Enumerate every live public/internal ingress
that reaches the changed consumer. For each ingress, state where validation
happens and whether it is before file/network load, decode, allocation, or GPU
work. Then trace each changed value from producer through every transformation
to its final consumer, stop/truncation boundary, and failure owner. A field
being present in a downstream dict is not evidence that behavior is aligned.
Flag untested or bypassing ingress paths as findings.

# Conditional audit — Path matrix
Run this when the change touches execution flow, feature flags, public contracts,
runtime behavior, async/concurrency, resources, or performance. For each
applicable path, provide checked evidence or "missing":
  - normal old path
  - normal new path
  - feature disabled
  - feature enabled
  - single request / single caller
  - concurrent requests / multiple callers
  - streaming or async event-loop path
  - low-resource / offload / constrained mode
  - public/direct caller and internal caller
  - test/benchmark path
Flag paths that only work on the happy path.

# Conditional audit — Resource lifecycle
Run this when the change allocates or passes files, memory, shared memory,
sockets, threads, tasks, processes, GPU buffers, pinned memory, locks, caches,
temp dirs, handles, or background work. For each resource, list:
  - allocated where
  - owner
  - passed to whom
  - consumed where
  - released where
  - allocation-failure behavior
  - failure-after-partial-allocation behavior
  - timeout/cancellation/shutdown behavior
  - concurrency bound
  - blocking point
  - test or evidence
Flag leaks, unbounded work, blocked event loops, swallowed failures, and
consumer hangs.

# Conditional audit — Evidence / benchmark
Run this when the change claims performance, quality, reliability, accuracy,
compatibility, or regression safety. Verify:
  - baseline and current runs are same hardware/input/config
  - warmup/compile/cold-start are separated
  - concurrency/request rate matches the claim
  - metric definition and sample count are clear
  - mean/median/stddev or repeated runs are sufficient for the claim
  - quality/accuracy/VRAM/resource regressions are ruled out
  - PR body evidence matches current head
  - screenshots are not the only proof
Flag unproven claims as findings.

Return findings in markdown. For each finding, first state:
1. what bad thing can happen;
2. why this PR owns it;
3. the smallest acceptable fix.
Give every blocking finding a stable local ID such as `P1 F1`. On the same
finding line include `DIFF:`, `PATH:`, `CONTRACT:`, `FAILURE:`,
`COUNTEREVIDENCE:`, and `FIX:`. Architecture suspicion without all six is an
investigation note, not a P0/P1/P2. In the owner audit,
map every `FAIL` to `FINDING:F1`; map `MISSING_EVIDENCE` to a finding or a
specific `DRAFT:<blocked evidence>` reason. For each public ingress, name the
actual dispatcher, first expensive operation, and owner adapter/consumer;
the existence of an unused helper is not coverage.
Every finding must also be referenced by an owner-row Disposition; if no
existing owner rule applies, put `OWNER_RULE:NONE` after its F ID. When two
parallel reviewers are merged, re-evaluate affected PASS/NOT_APPLICABLE rows
instead of appending the second reviewer's prose unchanged.
End with one `OWNER RULE GROUPS: <path>: core,<triggered groups>` line for each
grouped owner, then:
"OWNER RULE COVERAGE: <path or none>: X/Y stable IDs inventoried — A pass / B fail / C missing evidence / D not applicable" or
"OWNER RULE COVERAGE: <legacy path>: X source units inventoried — A pass / B fail / C missing evidence / D not applicable — legacy-unstructured, no exact clause-coverage claim" (one line per owner), then
"RISK TAGS: ...; LENSES: ..." and then on a separate line "AUDITS RUN: coverage,ingress,producer-consumer,duplication,layering,edge-cases,surface-area[,path,lifecycle,evidence] — N findings (Pa P0, Pb P1, Pc P2)".
```

### Owner prompts

- New model / pipeline / backend work needs two owner framings before the first public push:

```text
Role A: module owner. Review semantic parity against upstream. Treat shape-clean
and strict load as weak evidence. Check scheduler / denoising loop, embedding
order, activation, token order, special token + pad/eos attention mask,
preprocess, noise/action contracts, and real-checkpoint fail-fast behavior.
Return P0/P1/P2 findings only.

Role B: project/integration owner. Review whether this integration matches the
repository architecture. Check file/module ownership, public API surface, test
placement, stub-vs-real evidence separation, PR body reproducibility, and
whether any generic helper leaks caller-specific semantics. Return P0/P1/P2
findings only.
```

- Rule: Role A answers "does it preserve the module/domain semantics"; Role B answers "does it fit the project". Either side looking only at shape / smoke is not enough.

### Specialist owner prompts

- Add these when risk tags require them. Do not replace Role A/B unless the change is purely in that specialty.

```text
Role C: systems / runtime owner. Review resource lifetime, concurrency, failure
propagation, blocking behavior, thread/process/task boundaries, IPC or
serialization, GPU/CPU transfer, scheduler/event-loop impact, locks, caches,
and cleanup. Build a lifecycle table for every resource and a path matrix for
normal, disabled, concurrent, error, timeout, cancellation, and shutdown paths.
Return P0/P1/P2 findings only with file/function evidence.

Role D: evidence / benchmark auditor. Review whether the PR evidence proves the
claim. Check baseline parity, workload/config/request propagation, warmup or
compile exclusion, concurrency/request-rate semantics, sample count, mean/stddev,
quality/accuracy/VRAM/resource regressions, artifact provenance, and current-head
PR-body consistency. Return P0/P1/P2 findings only with concrete missing evidence.
```
