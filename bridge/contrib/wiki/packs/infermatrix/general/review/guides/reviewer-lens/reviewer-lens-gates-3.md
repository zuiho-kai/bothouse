---
name: reviewer-lens-gates-3
description: Reviewer Lens Gates 第 3 部分：authoring-time delta audit、scope triage for sub-agent findings、rebase / cherry-pick gate、inline review action mapping
metadata:
  scope: 只收 reviewer-lens 流程门禁的后四节（编写期增量审计、sub-agent finding 范围分诊、rebase/cherry-pick 门禁、inline review 动作映射）；其余见 reviewer-lens-gates-1 和 reviewer-lens-gates-2
---
# Reviewer Lens Gates（3/3）

## 现状

- 本页是源页的第 3/3 部分；前页 [[reviewer-lens-gates-1]]（Mini spec appendix、Risk-classified lens selection、Path and lifecycle matrices）
  和 [[reviewer-lens-gates-2]]（Design review before implementation、Committer pre-review、Fix closure is not full review、Full diff review、Subtraction claim audit）。

## 关键事实

- 源页：`knowledge/general/review/guides/reviewer-lens-gates.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-10；sources: 无

### Authoring-time delta audit

- When another Codex process, bot, or reviewer can point out multiple issues in a diff I wrote, treat that as authoring-time self-review failure. The issue is not just missing CI and not that the other process is stricter;
- it means I wrote code without continuously applying the same reviewer lens to the files and behavior surface I was changing.

- The retro must answer:

```text
Why did authoring not catch it?
- File/owner surface I failed to enumerate while editing:
- Producer-consumer or semantic/user path I did not trace:
- State matrix / edge / public surface I did not test:
- Test, harness, docs, CI, artifact behavior I treated as secondary:
- Authoring-time guard added so this is caught before another process/user next time:
```

- During authoring, run this extra pass as soon as a change touches multi-file UI, provider/serving/runtime bridge, CI/workflow, harness, public wording, or reviewer-follow-up code. Do not wait until the PR is ready.

1. **Changed-file census while editing:** assign every changed file to an owner before adding the next file. Tests, harnesses, workflows, and docs are behavior surfaces, not supporting cleanup.
2. **Producer-to-consumer trace:** trace from the user/public entrypoint to final consumer before implementing the helper-only fix. Include fake/real, success/failure, blocked/running, restart/abort, and stale-state branches that apply.
3. **Reviewer-comment simulation at the line:** for each touched file, ask which exact line another Codex/bot/reviewer would comment on. Focus on mismatched state text, skipped branches, stale docs, tests that do not exercise the changed path, and CI skip logic that hides the risky path.
4. **Guard landing in the same diff:** every real miss must become the nearest test, harness, CI gate, artifact inspection requirement, or explicit manual checklist item before continuing to broaden the patch. A later chat promise is not a guard.

- If time is insufficient to run this pass during authoring, report only `implementation draft`; do not say `ready`, `clean`, `fully checked`, or `mergeable`.

### Scope triage for sub-agent findings

- Before coding each P0/P1 finding, answer:

  - Root cause owner file/function?
  - Evidence source: grep, reviewer anchor, test failure, live run?
  - Minimal repair files?
  - Is it required for the current PR?
  - Test owner?

- Default conclusion format:

```text
root owner = X; downstream affected = Y; current PR patch = X only; test owner = Z
```

- If you cannot write that, do not edit yet.

### Rebase / cherry-pick gate

- After rebase, cherry-pick, or conflict resolution, old audits are stale. Review:

  - conflict files;
  - auto-merged files in touched functions;
  - current non-outdated reviewer threads.

- Minimum evidence:

```powershell
git range-diff <old-base-sha>...<old-head-sha> <new-base-sha>...HEAD
git diff --stat <new-base-sha>...HEAD
git diff <new-base-sha>...HEAD -- <conflict-or-auto-merged-files>
gh pr view <PR> --json headRefOid
```

- Ask whether mainline semantics were overwritten, shared paths got caller-specific rules, or a reviewer "why revert" comment is really pointing at a bug.

### Inline review action mapping

- For GitHub inline comments, anchor code is source of truth. Before editing:

```text
Comment: <reviewer 原文>
Anchor: <file:line + 锚点代码实际行为>
Pronoun target: <this / it / here / strategy 指向锚点里的哪个实体>
Reviewer asks: <按锚点语义拆成 1-3 个具体要求>
Code action: <要改哪个 owner/module，什么逻辑从哪里移到哪里>
Done check: <回到锚点附近看 diff，reviewer 是否会认为正面解决>
```

- Never fix by keyword alone.
