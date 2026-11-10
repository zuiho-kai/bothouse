---
name: reviewer-lens-gates-1
description: Reviewer Lens Gates 第 1 部分：mini spec appendix、按风险分类选择 lens（risk tags 与 lens routing）、path matrix 与 resource lifecycle matrix
metadata:
  scope: 只收 reviewer-lens 流程门禁的前三节（mini spec 附录、风险分类选 lens、路径与生命周期矩阵）；其余门禁见 reviewer-lens-gates-2 和 reviewer-lens-gates-3
---
# Reviewer Lens Gates（1/3）

## 现状

- This file holds workflow gates that are easy to forget when `reviewer_lens_audit.md` gets treated as a generic review checklist.

- 本页是源页的第 1/3 部分；续页 [[reviewer-lens-gates-2]]（Design review before implementation、Committer pre-review、Fix closure is not full review、Full diff review、Subtraction claim audit）
  和 [[reviewer-lens-gates-3]]（Authoring-time delta audit、Scope triage for sub-agent findings、Rebase / cherry-pick gate、Inline review action mapping）。

## 关键事实

- 源页：`knowledge/general/review/guides/reviewer-lens-gates.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-10；sources: 无

### Mini spec appendix

- Before non-trivial work, write the canonical [[mini-spec]]（mini_spec）. Reviewer-lens can add this appendix, but it cannot replace the canonical mini spec.

- Trigger when a change touches:

  - new model / pipeline / backend;
  - step / graph / cache / batching / serving / offline / benchmark path outside normal `forward()`;
  - public API, CLI, `extra_args`, `mm_processor_kwargs`, multimodal key, AR-to-DiT bridge field;
  - scheduler, decode, VAE latent, KV/cache, batch expansion semantics;
  - performance claims or remote validation evidence.

- Appendix fields:

```text
Reviewer-lens appendix
- Changed surfaces:
- Field contract:
  - ingress:
  - default semantics:
  - owner:
  - consumers:
  - failure policy:
- Path parity matrix:
  - normal path:
  - variant paths:
  - shared helper or intentional split:
- Non-default tests:
- Validation and PR evidence:
- Explicit non-goals:
```

- If the mini spec cannot be written, do not start coding.

### Risk-classified lens selection

- Before any non-trivial review, PR self-audit, or sub-agent delegation, classify the change. Do not assume module-owner + project-owner is sufficient.

```text
Risk tags:
- public API / user-facing contract:
- module semantic contract:
- producer-consumer contract:
- async / concurrency / scheduling:
- resource lifetime / cleanup:
- data format / serialization / IPC:
- performance / benchmark evidence:
- error / cancellation / timeout:
- feature flag / config / default behavior:
- backward compatibility:
- test / validation evidence:
Selected lenses:
```

- Lens routing:

  - Module semantic contract -> module owner.
  - Repo fit, API/config/test/docs/PR evidence -> project owner.
  - Async, scheduler, threads, processes, IPC, shared resources, locks, caches, GPU/CPU transfer, pinned memory, background work -> systems/runtime owner.
  - Performance, quality, reliability, accuracy, or regression claims -> evidence/benchmark auditor.
  - Public API, streaming, request/response schemas -> project owner + contract matrix.

- If a required lens is skipped, the final answer must say `partial review` and name the missing lens. Never say `clean`, `ready`, or `fully reviewed` without risk tags and selected lenses.

### Path and lifecycle matrices

- For any selected systems/runtime lens, build both matrices before writing findings.

```text
Path matrix
- normal old path:
- normal new path:
- feature disabled:
- feature enabled:
- single caller/request:
- concurrent callers/requests:
- streaming or async event-loop:
- low-resource/offload/constrained mode:
- public/direct caller:
- internal caller:
- error before allocation:
- error after partial allocation:
- consumer timeout:
- cancellation/shutdown:
- test/benchmark path:
```

```text
Resource lifecycle matrix
- resource:
- allocated where:
- owner:
- transferred/stored where:
- consumed where:
- released where:
- allocation failure:
- partial-allocation failure:
- worker/task/thread failure:
- timeout/cancellation/shutdown:
- concurrency bound:
- blocking point:
- evidence/test:
```

- Missing rows are findings or explicit evidence gaps; do not silently drop paths because the happy path works.
