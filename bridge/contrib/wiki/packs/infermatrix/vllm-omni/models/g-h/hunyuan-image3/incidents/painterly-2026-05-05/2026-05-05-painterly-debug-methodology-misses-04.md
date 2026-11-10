---
name: 2026-05-05-painterly-debug-methodology-misses-04
description: 2026-05-05 远端代码累积 VAE encode/decode FP16 改 BF16、disable autocasts、force MATH SDPA、swap 本地 SigLIP2 等改变行为的 patch 忘记回退，后续分不清 baseline 是否 vanilla；解法是每次开局 grep BUG-PROBE 等审计，实验 patch 用独立 marker 与 env var gate
metadata:
  scope: 只收改变行为的 patch 没回退、缺 patch ledger 的这一条；swap SigLIP2 的接口错归 2026-05-05-painterly-debug-methodology-misses-03，翻 cuDNN/CUBLAS 旋钮把容器跑崩归 2026-05-05-painterly-debug-methodology-misses-05
---
# 2026-05-05 — 远端代码累积多个改变行为的 patch 没回退，影响后续诊断

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-05-painterly-debug-methodology-misses-04.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-05-painterly-debug-methodology-misses-04`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：远端代码累积多个改变行为的 patch 没回退，影响后续诊断
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **症状**：调研中陆续 patch 了 `VAE decode FP16→BF16`、`VAE encode FP16→BF16`、`disable autocasts`、`force MATH SDPA`、`swap to local SigLIP2` ……失败的实验回退了，成功+无影响的实验留下 dump probe，但 **"实验性的精度改动"（BF16/FP16 swap）忘记 revert**。后面跑诊断时分不清当前 baseline 是 vanilla cr/pr3107-fix 还是带了 4 个隐式改动的混合态。
- **根因**：缺少 patch ledger。每次 patch 写一个 `.sh` 脚本到 `/tmp/patch_*.sh`，但没维护"当前活跃 patch 列表"，靠肉眼追踪。
- **解法**：每次启动新调研 session 先 `grep -rn "BUG-PROBE\|VLLM_OMNI_DUMP\|_OmniSigl" /rebase/vllm-omni/` 全量审计当前所有改动；把改变行为的 patch 跟纯 dump probe 区分清楚，前者要求 explicit toggle（env var 或最小改动），不能默认 enabled。
- **对未来的提醒**：
  - 远端 patch session 开头和切换大假设之前，**强制审计当前 patch 状态**。`grep "BUG-PROBE"` 是廉价 check
  - 探针 patch（dump、log）和实验 patch（改 dtype/kernel/algo）应该用不同的 marker。比如 dump 用 `BUG-PROBE`，实验改动用 `EXPERIMENT-PATCH`，方便选择性 grep + revert
  - 用 env var gate 一切实验性数值改动，不要直接改默认值——这样 baseline 跟 vanilla 一致，experiment 跟 baseline 在同一份代码里 toggle

---
