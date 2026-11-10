---
name: pr-review-breaking-changes
description: PR review — when a default, protocol, or API changes (incl. removed/renamed upstream APIs), sweep ALL in-repo consumers and remaining callers repo-wide with checkout-drift discipline; unexplained survivors and undocumented ordering assumptions are findings
---

## Fix
- grep every in-repo consumer of the old behavior: examples/, docs/, recipes/,
  clients, tests (GT #4679).
- Removed-API co-change sweep: enumerate ALL remaining callers with grep (never
  memory; record command + hit count) incl. `vllm_omni/diffusion/`, vendored
  code, `gpu_*`/`npu_*` pairs. Every hit: updated here or intentionally
  untouched (say why). Unexplained survivor = finding (#4810 → issue #4891).
- CHECKOUT STATE (see REPO.checkout): on the PR-TIME TREE an unexplained
  surviving caller is a REAL finding — report it. On CURRENT MAIN zero
  survivors proves nothing (post-PR fixes may exist): `git log --oneline --
  <file>`; a file named in the PR body but absent from the diff is a candidate
  unswept caller, never "an earlier iteration".
- Variant sweep: each confirmed defect is an exemplar — grep structural
  siblings (same API, copy-paste blocks, paired AR/DiT or GPU/NPU file).
- New guard/assert/NotImplementedError: ask which existing tests/CI exercise
  the guarded path (#4834 broke merge CI → #4905/#4912).
- Implicit ordering assumption without comment/assert = finding (GT #4849).

## Anti-patterns
- Approving on "core logic correct" while consumers assume the old default.
- Scoping to touched files when the diff's REASON implies unswept sites.
- Trusting a clean grep of post-fix main as proof about the PR.
