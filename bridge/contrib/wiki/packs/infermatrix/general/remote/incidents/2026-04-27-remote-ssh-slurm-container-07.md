---
name: 2026-04-27-remote-ssh-slurm-container-07
description: 2026-04-27 远端错题，srun --pty 在非交互 SSH 下报 ioctl(TIOCGWINSZ) 错误但命令仍执行；真交互需 tmux
metadata:
  scope: 只收 2026-04-27「srun --pty 在非交互 SSH 下报 ioctl 错误但仍能执行」这一次事故的症状、根因、结论和提醒
---
# 2026-04-27 — srun --pty 在非交互 SSH 下报 ioctl 错误但仍能执行

## 关键事实

- 源页：`knowledge/general/remote/incidents/2026-04-27-remote-ssh-slurm-container-07.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-04-27-remote-ssh-slurm-container-07`
- 归属：`general/remote`
- 状态：已验证
- 搜索词：srun --pty 在非交互 SSH 下报 ioctl 错误但仍能执行
- 影响范围：general/remote

## 决策与踩坑

### 2026-04-27 — srun --pty 在非交互 SSH 下报 ioctl 错误但仍能执行

- **症状**：`srun: error: ioctl(TIOCGWINSZ): Inappropriate ioctl for device` + `Not using a pseudo-terminal, disregarding --pty option`
- **根因**：通过 `ssh host 'cmd'` 非交互方式调用 srun，没有 TTY，--pty 无效
- **结论**：不影响命令执行，输出仍然正常返回；忽略这两行错误即可
- **提醒**：需要真正交互式 shell 时必须用 tmux，不能靠 ssh host 'srun --pty bash'
