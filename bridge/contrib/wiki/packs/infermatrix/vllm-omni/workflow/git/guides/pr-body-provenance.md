---
name: pr-body-provenance
description: "PR body 中性能/精度/图片证据的 provenance：Evidence matrix（E1/E2/E3）、Required provenance、headRefOid 与 run WT/HEAD 的 Head binding、Image gate（PIL、SHA256、raw URL），来源 PR #3766 与 #3626"
metadata:
  scope: 只收性能/精度/图片证据的矩阵与 head 绑定；PR body 模板归 pr-body-evidence，新模型证据分层归 pr-body-model-evidence，隐私脱敏归 pr-body-privacy
---
# PR Body Provenance

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/guides/pr-body-provenance.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, git；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#3626；#3766
- Use this before putting performance, accuracy, metric tables, or output images into a PR body or PR comment.

### Evidence matrix

- Write this in the draft before publishing any performance / accuracy / image conclusion:

```markdown
| ID | Purpose | Input Source | Path | Requests | Batch Knobs | Timing Scope | Result | PR Placement |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| E1 | Compatibility smoke | Temporary prompt | DiT-only | 2 | max_num_seqs=2, diffusion_batch_size=2 | N/A | logs only | Test Result / smoke |
| E2 | Official accuracy | Official fixture | AR-to-DiT | 2 | DiT max_num_seqs=2, diffusion_batch_size=2 | N/A | CLIP/SSIM/PSNR + image | Test Result / accuracy |
| E3 | Official performance | Official fixture | AR-to-DiT | 2 | baseline 1/1 vs grouped 2/2 | omni.generate only | elapsed / throughput | Test Result / performance |
```

- No matrix means no performance / accuracy / image claim.

### Required provenance

- For every table or image, state:
  - exact script or command;
  - input and prompt;
  - official/user-specified input vs smoke prompt;
  - request count and batching knobs;
  - timing scope and whether model initialization is excluded;
  - metric reference;
  - conclusion this evidence supports, and no more.
- `Test Plan` describes how E1/E2/E3 can be reproduced. `Test Result` gives actual logs, metrics, tables, and stable image URLs. `Purpose` can only claim what the matrix supports.
- Smoke evidence must be labeled `smoke` or `compatibility`; it cannot be titled `accuracy` or `performance`.

### Head binding

- Before posting any test image, metric, or raw artifact URL:

```powershell
gh pr view <PR> --repo vllm-project/vllm-omni --json headRefOid,headRefName,headRepositoryOwner
```

- Then confirm run logs/status bind to the same checkout:

```bash
cat <status-file>      # must include WT=<sha> or HEAD=<sha>
grep -E 'HEAD=|WT=|1 passed|EXIT_STATUS|\[ONLINE\]' <log-file>
```

- `headRefOid`, run `WT/HEAD`, metrics, and image mtime must belong to the same run. If not, do not post it as current evidence. Historical evidence must be labeled with its historical head.

### Image gate

- Before posting:

```powershell
python -c "from PIL import Image; import sys; im=Image.open(sys.argv[1]); print(im.format, im.size, im.mode)" <image>
Get-FileHash -Algorithm SHA256 <image>
Invoke-WebRequest -Uri <raw-url> -Method Head -UseBasicParsing
```

- Also open the image and confirm it is not blank, stale, broken, or the wrong case.
- Use stable renderable URLs. Prefer an artifact branch with `raw.githubusercontent.com/.../artifact.png`. Do not open an artifact branch PR.

### What caused this

- PR #3766 mixed DiT-only temporary smoke data with official IT2I / AR-to-DiT evidence. PR #3626 posted an online accuracy image from an older run and leaked an internal remote artifact path.
  - The durable rule is: evidence is not publishable until it is bound to input, path, config, run head, and conclusion scope.
