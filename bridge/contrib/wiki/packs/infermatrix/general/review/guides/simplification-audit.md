---
name: simplification-audit
description: Simplification audit — bounded audit for dead code, over-defensive code and duplicated lifecycle facts when a diff adds or expands helpers, fallbacks, validators, lifecycle state or public behavior
metadata:
  scope: 只收 diff 触发的有界 simplification audit（consumer 证明、trust boundary、lifecycle 事实合并、可上报 finding 的要件）；审查主流程归 review-execution-contract，ownership 规则归 code-taste
---
# Simplification audit

## 现状

- Use this bounded audit when a diff adds or expands a helper, class, fallback, compatibility branch, defensive copy or validator, lifecycle state, or public behavior.
- It extends the independent review contract ([[review-execution-contract-1]]) and applies the ownership rules in Code Taste ([[code-taste]]).
- It is not a repository-wide cleanup pass.

## 关键事实

- 源页：`knowledge/general/review/guides/simplification-audit.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-08-18；updated: 2026-08-18
- 来源：deepseek-ai/deepseek-harness:.agents/skills/dsh-find-simplifications
- Adapted from DeepSeek Harness's [`dsh-find-simplifications`](https://github.com/deepseek-ai/deepseek-harness/tree/master/.agents/skills/dsh-find-simplifications), with repository-specific Agent Notes, Node packages, and protected seams removed.

### Prove consumers before calling code dead

- Start with the changed or newly expanded symbol, config key, event, hook, branch, or wire string.
- Use `rg` for the exact name and its call forms, then read the call sites.
- Classify every consumer:
  - **production:** runtime source, loaders, registries, entrypoints, generated dispatch, plugins, examples used as smoke paths, or external/public contracts;
  - **non-production:** tests, fixtures, snapshots, docs, comments, and type-only references;
  - **ambiguous:** reflection, dynamic import, string dispatch, serialization, compatibility shims, scripts, and examples whose production role is unclear.
- Check exported APIs, decorators, registries, generated code, config/wire names, and public compatibility before proposing deletion.
- A strong dead-code finding names the searched surface and shows that only non-production consumers remain, or that the branch is unreachable from every supported ingress.

### Audit defensive code by trust boundary

- For every copy, freeze, validator, fallback, catch-all, rollback, or callback capture, record:
  1. where the value or failure originates;
  2. whether the boundary is trusted and typed or external and untrusted;
  3. who owns it after handoff;
  4. the concrete failure the defense prevents;
  5. whether another layer already enforces the same fact.
- Preserve validation and ownership transfer at parsers, user configuration, queues, model/tool JSON, durable files, workers, processes, RPC/wire decoders, and native-resource boundaries.
- Same-process typed calls usually borrow their declared values; hostile-getter tests, mutation after a documented readonly handoff, or broad exception swallowing do not alone justify a speculative contract.
- Call code over-defensive only when the threatened behavior is unsupported or already owned elsewhere and the duplicate defense has a concrete cost:
  - extra allocation, hidden fallback, inconsistent error semantics, public API growth, state duplication, unreachable rollback, or dedicated tests for behavior no consumer needs.

### Collapse duplicated lifecycle facts carefully

- For asynchronous or resource-owning code, draw the owner and transition graph.
- Map each sentinel, readiness promise, cancellation flag, terminal-result guard, disposer, rollback list, and shutdown branch to the fact it protects.
- Merge mechanisms that mirror the same liveness, readiness, settlement, or ownership fact.
- Preserve distinct machinery when it separately protects partial allocation rollback, first-terminal-outcome arbitration, callback containment, worker/process ownership, synchronous publication, or dispose-to-quiescence.

### Report only actionable simplifications

- Every finding must bind to a changed `path:line` and include:
  - the exact candidate and why the current diff makes it relevant;
  - production, non-production, and ambiguous consumer evidence;
  - trust or lifecycle ownership evidence when defensive code is involved;
  - the concrete maintenance, correctness, resource, or contract cost;
  - the smallest safe `DELETE`, `DEFER`, `INLINE`, `MERGE`, or `MOVE` action;
  - the behavior or compatibility that the action intentionally gives up.
- If evidence is insufficient, record the gap in the internal check instead of publishing a finding.
- The review bot reports deletion opportunities; it does not modify the reviewed repository.

## 决策与踩坑

- (Prove consumers before calling code dead) No text match is not proof of no consumer.
- (Prove consumers before calling code dead) Reject the candidate when a production caller exists and deletion would be a feature decision, when an explicit compatibility or design contract owns it, or when removal only moves the same complexity elsewhere.
- (Report only actionable simplifications) Do not report typo cleanup, subjective complexity, a one-off unused local, or "this looks defensive" without call-site and boundary proof.
