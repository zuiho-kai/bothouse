---
name: 2026-04-23-remote-ssh-slurm-container-04
description: 2026-04-23 远端错题，“释放资源”只停了应用进程没退 srun，Slurm job 仍占节点；按 PID/PGID 停止并确认 allocation 释放
metadata:
  scope: 只收 2026-04-23「释放资源只杀进程没退 srun」这一次事故的症状、根因和解法；srun 生命周期通则归 srun-lifecycle
---
# 2026-04-23 — "释放资源"只杀进程没退 srun

## 关键事实

- 源页：`knowledge/general/remote/incidents/2026-04-23-remote-ssh-slurm-container-04.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-04-23-remote-ssh-slurm-container-04`
- 归属：`general/remote`
- 状态：已验证
- 搜索词："释放资源"只杀进程没退 srun
- 影响范围：general/remote

## 决策与踩坑

### 2026-04-23 — "释放资源"只杀进程没退 srun

- **症状**：本轮服务进程停止后，Slurm job 仍占着节点。
- **根因**：只停止了应用进程，srun shell 和 allocation 生命周期仍未结束。
- **解法**：按本轮记录的 PID/PGID 停止进程，退出本轮容器和 srun shell，再用 job ID 查询确认 allocation 已释放。禁止按进程名扫描或终止其他任务。
