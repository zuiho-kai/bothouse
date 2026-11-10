---
name: 2026-04-22-remote-ssh-slurm-container-02
description: 2026-04-22 远端错题，容器默认 TRANSFORMERS_CACHE 覆盖 HF_HOME 使模型路径指错；空字符串不等于 unset
metadata:
  scope: 只收 2026-04-22「TRANSFORMERS_CACHE 覆盖 HF_HOME」这一次事故的症状、根因和解法；HF 离线约定归 hf-offline-mandatory
---
# 2026-04-22 — TRANSFORMERS_CACHE 覆盖 HF_HOME

## 关键事实

- 源页：`knowledge/general/remote/incidents/2026-04-22-remote-ssh-slurm-container-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-04-22-remote-ssh-slurm-container-02`
- 归属：`general/remote`
- 状态：已验证
- 搜索词：TRANSFORMERS_CACHE 覆盖 HF_HOME
- 影响范围：general/remote

## 决策与踩坑

### 2026-04-22 — TRANSFORMERS_CACHE 覆盖 HF_HOME

- **症状**：模型路径指向 `/models/huggingface/transformers/` 而非 `$HF_HOME/hub/`
- **根因**：容器默认设了 `TRANSFORMERS_CACHE`，优先级高于 `HF_HOME`
- **关键**：`TRANSFORMERS_CACHE=`（空字符串）≠ `unset`
- **解法**：`unset TRANSFORMERS_CACHE`
