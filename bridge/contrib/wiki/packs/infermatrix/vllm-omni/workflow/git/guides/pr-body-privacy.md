---
name: pr-body-privacy
description: 公开 PR body / comment 隐私边界：允许的公开证据、禁止出现的本地/远端路径与机器别名、gh pr view 回读 Select-String 扫描、Remote GPU validation 公开写法
metadata:
  scope: 只收公开 PR 文本的脱敏规则与回读扫描；PR body 模板归 pr-body-evidence，证据 provenance 归 pr-body-provenance
---
# PR Body Privacy

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/guides/pr-body-privacy.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, git；created: 2026-07-10；updated: 2026-07-10
- Public PR body / comment text must contain reviewer-facing reproducible evidence, not local or remote work logs.

### Allowed public evidence

- PR head SHA or run checkout SHA when evidence provenance needs it.
- Public model id or public snapshot revision.
- Workload: prompt source, resolution, frames, steps, guidance, run count, warmup.
- Command or repo-relative script path.
- Result table: latency, memory, accuracy, pass/fail.
- Stable artifact URL.

### Forbidden in public PR text

- Windows user directory, local absolute path, remote user path, venv path, cache path, `/tmp` path.
- Remote machine alias, host, port, account, internal work directory.
- Internal probes such as cache-miss logs, local package-missing notes, or local import blockers.
- "Artifact source: /data/..." and similar execution bookkeeping.
- These details can go into a private validation artifact if they are needed for audit.

### Validation rule

- Local environment failure is not a public Test Result. Prefer remote real-path validation. If only an import/cache probe ran, it is internal debugging, not reviewer-facing validation. If validation is still pending, say `validation pending`.
- Performance PRs require same checkout, same machine, same workload, and a real Omni vs HF/original baseline. Do not publish unverified speedup.

### Read-back scan

- After `gh pr edit --body-file`, read back and scan:

```powershell
gh pr view <PR> --repo vllm-project/vllm-omni --json body |
  Select-String -Pattern "C:\\|D:\\|/home/|/root/|/tmp/|\\.venv|HF_HOME|cache|port|host|Windows|本地"
```

- Any match is deleted by default unless it is genuinely public reproduction input.

### Public shape

```markdown
### Remote GPU validation

- PR head: `<sha>`
- Model: `dg845/LTX-2.3-Diffusers@<revision>`
- Workload: 384x512, 25 frames, 20 steps, guidance 4.0, 1 warmup + 3 measured runs.
- Result: `<table>`
```

- Acceptance: the PR body reads like a reviewer reproducibility report; it contains no private local/remote path; each performance conclusion has a same-scope baseline.
