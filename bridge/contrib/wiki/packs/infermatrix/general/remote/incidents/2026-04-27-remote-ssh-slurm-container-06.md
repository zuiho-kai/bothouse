---
name: 2026-04-27-remote-ssh-slurm-container-06
description: 2026-04-27 远端错题，新登录节点 srun 不在 PATH，需先 source /etc/profile 并 module load slurm
metadata:
  scope: 只收 2026-04-27「新登录节点 srun 不在 PATH，需 module load」这一次事故的症状、根因、解法和提醒
---
# 2026-04-27 — 新登录节点 srun 不在 PATH，需 module load

## 关键事实

- 源页：`knowledge/general/remote/incidents/2026-04-27-remote-ssh-slurm-container-06.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-04-27-remote-ssh-slurm-container-06`
- 归属：`general/remote`
- 状态：已验证
- 搜索词：新登录节点 srun 不在 PATH，需 module load
- 影响范围：general/remote

## 决策与踩坑

### 2026-04-27 — 新登录节点 srun 不在 PATH，需 module load

- **症状**：`bash: line 1: srun: command not found`
- **根因**：部分登录节点用 Environment Modules 管理 Slurm
- **解法**：`source /etc/profile && module load slurm/slurm/23.02.7 && srun ...`
- **提醒**：进新登录节点先 `module avail 2>&1 | grep -i slurm` 确认模块名
