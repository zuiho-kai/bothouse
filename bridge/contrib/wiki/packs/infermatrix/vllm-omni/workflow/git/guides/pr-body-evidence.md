---
name: pr-body-evidence
description: PR body 入口：vLLM-Omni PR 描述固定 Purpose / Test Plan / Test Result 三个标题、渲染级验收（no-BOM UTF-8 body file、gh pr edit --body-file 与回读）、公开可复现要求与 Suggested shape
metadata:
  scope: 只收 PR 描述模板、渲染 gate 与公开复现结构；性能/精度/图片证据归 pr-body-provenance，新模型证据分层归 pr-body-model-evidence，隐私脱敏归 pr-body-privacy
---
# PR Workflow · PR body entry

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/guides/pr-body-evidence.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, git；created: 2026-07-10；updated: 2026-07-10
- This page is the short entry for PR body writing. Deeper evidence rules live in:
  - [[pr-body-provenance]]（pr_body_provenance）: performance / accuracy / image evidence, PR head binding, artifact provenance.
  - [[pr-body-model-evidence]]（pr_body_model_evidence）: new model evidence split: source parity / stub smoke / real checkpoint.
  - [[pr-body-privacy]]（pr_body_privacy）: public PR body privacy and remote/local environment redaction.

### Template

- Before writing or editing a vLLM-Omni PR description, read `.github/PULL_REQUEST_TEMPLATE.md`.
- vLLM-Omni PR bodies use exactly:

```markdown
 ## Purpose
 ## Test Plan
 ## Test Result
```

- Rules:
  - Keep these headings unchanged.
  - `Test Plan` is for commands / scripts / reproduction path.
  - `Test Result` is for actual validation result, metric, image, or pass/fail summary.
  - Do not use generic `Summary / Testing`.
  - Do not mechanically list `DCO`, CI job names, old validation SHAs, or machine bookkeeping unless the user explicitly asks for provenance or the PR evidence needs it.
- Small bugfix / reviewer-followup PRs should read like reviewer-facing behavior notes: what was broken, what changed, how it was covered.

### Render gate

- Trigger when opening a PR, editing a PR body, or posting PR evidence / images.
- Do not:
  - dump work-log checklists into `Test Plan`;
  - use temporary image hosts such as `tmpfiles`, `0x0`, or `transfer.sh`;
  - write Markdown code fences inside PowerShell double-quoted here-strings.
- Use no-BOM UTF-8 body files:

````powershell
$body = @'
 ## Purpose

...

```bash
command
```
'@
$tmp = [System.IO.Path]::GetTempFileName()
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmp, $body, $utf8NoBom)
gh pr edit <PR> --body-file $tmp
Remove-Item $tmp
````

- Read back after update:

```powershell
$view = gh pr view <PR> --repo vllm-project/vllm-omni --json body,url,isDraft | ConvertFrom-Json
$view.body.Contains('```bash')
$view.body.Contains('```yaml')
$view.body.Contains('```python')
$view.body -match "[\x00-\x08\x0B\x0C\x0E-\x1F]"  # must be False
```

### Public reproduction

- For e2e / accuracy / performance PR bodies, `Test Plan` should be copyable by a reviewer and contain only public or repo-relative information:
  - repo-relative script path or command;
  - repo-relative YAML path and key fields;
  - prompt, image, sampling params, or `Omni.generate` request construction;
  - metric calculation and public reference file / artifact;
  - stable artifact URL when needed.
- Machine, cwd, venv, env vars, internal host/path/cache details belong in a private validation artifact, not the public PR body. See [[pr-body-privacy]]（pr_body_privacy）.

### Evidence downshift

- If the PR uses performance, accuracy, or image evidence, read [[pr-body-provenance]]（pr_body_provenance） before writing the body.
- If the PR is a new model / pipeline / backend / checkpoint adapter, read [[pr-body-model-evidence]]（pr_body_model_evidence） before writing the body.

### Suggested shape

```markdown
 ## Purpose

<behavior problem and smallest fix boundary>

 ## Test Plan

### Public Reproduction
### Run Command
### Request Construction
### Metric Comparison

 ## Test Result

### E2E Evidence
### Metrics
### Artifacts
```

- Acceptance: the PR page reads like a reproducible reviewer report, not a chat log.
