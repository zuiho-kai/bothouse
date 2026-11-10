---
name: reviewer-lens-gates-2
description: Reviewer Lens Gates 第 2 部分：design review before implementation、committer pre-review、fix closure is not full review、full diff review、subtraction claim audit
metadata:
  scope: 只收 reviewer-lens 流程门禁的中间五节（实现前设计审查、committer 预审、修复闭环、全量 diff 审查、减法声明审计）；其余见 reviewer-lens-gates-1 和 reviewer-lens-gates-3
---
# Reviewer Lens Gates（2/3）

## 现状

- 本页是源页的第 2/3 部分；前页 [[reviewer-lens-gates-1]]（Mini spec appendix、Risk-classified lens selection、Path and lifecycle matrices），
  续页 [[reviewer-lens-gates-3]]（Authoring-time delta audit、Scope triage for sub-agent findings、Rebase / cherry-pick gate、Inline review action mapping）。

## 关键事实

- 源页：`knowledge/general/review/guides/reviewer-lens-gates.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-10；updated: 2026-07-10；sources: 无

### Design review before implementation

- For runner / prefix cache / shared execution state / pipeline / public API / new model / batching / streaming / multi-module ownership changes, run owner framing before choosing a patch shape:

```text
Role A: module owner. Given the user request and relevant current code, propose
how this module should be changed before implementation. Identify the owning
module/data boundary, required contracts, state matrix, edge cases, and tests.
Return P0/P1 risks in the proposed approach, and name the simplest acceptable
implementation shape. Do not review an already-written patch.

Role B: project/integration owner. Given the user request and relevant current
code, review the intended change at repo level before implementation. Check
whether the change belongs in this module, whether it expands public/internal
surface, whether it needs docs/PR evidence, and what validation matrix protects
other pipelines/backends. Return P0/P1 risks and the smallest repo-aligned plan.
Do not review an already-written patch.
```

- Pure typo, formatting, and non-behavior docs edits can skip this gate.

### Committer pre-review

- When the user wants "no committer surprises" or you are preparing merge, module-owner review is not enough. Add a project owner / committer framing for:

  - public API / `extra_body` / `extra_args` / `mm_processor_kwargs` contract matrix;
  - endpoint-layer structured error, not just helper-level exceptions;
  - test placement in behavior owner files;
  - PR body / Test Plan / Test Result matching current head and current test surface;
  - current unresolved / non-outdated reviewer threads.

- Module owner says whether the model semantics are right. Committer owner asks whether the public surface, tests, wording, and bad paths can merge.

### Fix closure is not full review

- After fixing a sub-agent finding, send the new diff back through the same framing:

```text
Prior findings 是否真的 resolved？
这次修复有没有引入新的 API/test/PR-body surface？
只返回 P0/P1/P2 或 no further findings。
```

- Finding closure does not mean full PR clean.

### Full diff review

- Run this gate for a full-project review, a large or suspicious diff, the independent review after development, and every pre-push or pre-PR review. First confirm the real target base from the current branch, PR, or user request.
- Do not assume the default branch is `main` or that the remote is `origin`.

- Record the target ref and resolve it once to `<target-base-sha>`; every command in the same review must use that frozen SHA, not the movable ref. If the task provides only an exact baseline SHA and no target ref, record `TARGET REF: n/a` and use that SHA as `<target-base-sha>`.
- Then resolve one comparison commit:

  - If the user or task froze an exact baseline SHA, use that SHA.
  - For a feature branch or PR, use `git merge-base <target-base-sha> HEAD` and record the resulting SHA.
  - If neither is known, stop and determine the target branch or baseline; do not guess from the current branch name.

- For an uncommitted implementation, collect the working-tree surface:

```powershell
git status --short
git diff --stat <comparison-commit>
git diff --name-status <comparison-commit>
git diff --numstat <comparison-commit>
git ls-files --others --exclude-standard
```

- `git diff <comparison-commit>` covers committed, staged, and unstaged tracked content relative to that commit, but not untracked files. Every untracked file that belongs to the task must be opened and reviewed in full;
- unrelated untracked files remain out of scope and must not be silently included or deleted.

- For a committed branch or PR with a clean worktree, collect the branch surface:

```powershell
git status --short
git diff --stat <target-base-sha>...HEAD
git diff --name-status <target-base-sha>...HEAD
git diff --numstat <target-base-sha>...HEAD
```

- If committed changes and working-tree changes coexist, review `<comparison-commit> -> working tree` first; a `<target-base-sha>...HEAD` review alone is incomplete.

- Then run:

  1. **Diff census:** top tracked and in-scope untracked files by added lines or file size, owner, why in scope, whether split is possible.
  2. **Semantic trace:** every new helper / dataclass / parser / scheduler / docs default traced to public consumer.
  3. **Garbage pass:** duplicate logic, tensor-valued `or`, silent fallback, unused knob, docs/perf overclaim, helper-only tests, horizontal misses.

- Output must include:

```text
DIFF REVIEW SURFACE: <actual resolved target ref/SHA and comparison commit -> reviewed head or working tree>
TOP FILES REVIEWED: ...
IN-SCOPE UNTRACKED REVIEWED: <file, owner, size/lines, why it belongs>
UNRELATED UNTRACKED EXCLUDED: <file, why it does not belong>
AUDITS RUN: diff-census, semantic-trace, garbage-pass, reviewer-lens-1..4
KNOWN FINDINGS CLOSED != FULL DIFF CLEAN
```

- Unless all three passes ran, do not say `full PR reviewed` or `clean`.

### Subtraction claim audit

- “做了减法”“合并了测试”“缩小了 diff”是独立于 correctness review 的可验证声明。参数化以后看起来更整齐、case 数下降、测试全绿或 correctness reviewer 没有 finding，都不能证明代码实际减少。

- 先冻结目标 base 和开始减法前的 comparison head，再分别测量：

```powershell
git diff --numstat <target-base-sha>...HEAD -- <affected paths>
git diff --numstat <before-subtraction-sha>..HEAD -- <affected paths>
```

- 未提交改动把第二条的 `HEAD` 换成 working tree comparison。第一组回答“当前 PR 总体仍有多大”，第二组回答“本轮声称的减法实际净增还是净删”；两组不能互相替代。新增 regression 与删除重复测试分别报告，不能用新覆盖的必要性把“净增”表述成“已经减量”。

- 测试减法开始前列出 `production invariant -> owner test -> required wiring/dispatcher evidence`。同一不变量默认只保留一个最近 owner 单测；只有 production wiring、错误边界或不同 dispatcher 的最终 consumer 无法由 owner 单测证明时，才保留一条集成证据。删除后必须报告：

  - 受影响测试路径的 additions、deletions 和 net；
  - 删除了哪些重复表达，保留在哪个 owner；
  - case 数变化，且明确它不是行数指标；
  - 同一聚焦测试命令的实际结果。

- 正确性审查和减法审查可以由同一个人执行，但任务和结论必须分别写明；只被要求找 P0–P2 的 reviewer 没有承担代码预算验收，不能用它的 `no further findings` 证明 scope 已收敛。
