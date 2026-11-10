---
name: issue-answer-contract
description: Issue answering — the answer contract (root cause file:line, mechanism, fix AND workaround, verification, linked issues/PRs), thread grounding, and status semantics; an incomplete-but-grounded draft ships with caveats instead of escalating
---

## Fix (answer contract, every slot)
1. Root cause with file:line for every claim — re-open cited lines; quote the
   decisive line or two.
2. Mechanism: map the reporter's traceback/config/versions to the code path;
   name the commit/PR that changed behavior when discoverable (git log -S).
3. Fix AND workaround: the proper fix (or merged PR) plus what the reporter can
   do now — exact commands/YAML.
4. Verification: one command the reporter runs to confirm.
5. Thread grounding: quote the maintainer comments you corroborate; cross-ref
   linked issues/PRs (#4809-class); verify merge state with gh before saying
   "merged"; state the tree revision you verified against.
6. **Disposition** matching the thread's last maintainer action: close /
   keep-open / duplicate-of-#N / needs-info + reopen condition; engage named
   commenters; preempt red herrings ("unrelated: X").
7. Triage verdicts (invalid/not-reproducible/duplicate): state verdict,
   evidence, and what evidence would reopen it.

## Status semantics (do not discard your draft)
`needs_review` ONLY with no useful draft — an incomplete-but-grounded answer
ships as success with caveats. Retry a failed tool once; never report the
iteration cap as the blocker — report what you verified.

## Anti-patterns
- Correct one-paragraph diagnosis, no citations/workaround/verification.
- "Fixed in <PR>" without checking the PR touches the failing path.
