---
name: 2026-04-23-remote-ssh-slurm-container-03
description: 2026-04-23 远端错题，multiprocessing spawn 子进程 chdir 到 Lustre cwd 报 PermissionError，父进程只见 EOFError
metadata:
  scope: 只收 2026-04-23「multiprocessing spawn 子进程 cwd PermissionError」这一次事故的症状、根因、解法和提醒
---
# 2026-04-23 — multiprocessing spawn 子进程 cwd PermissionError

## 关键事实

- 源页：`knowledge/general/remote/incidents/2026-04-23-remote-ssh-slurm-container-03.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-04-23-remote-ssh-slurm-container-03`
- 归属：`general/remote`
- 状态：已验证
- 搜索词：multiprocessing spawn 子进程 cwd PermissionError
- 影响范围：general/remote

## 决策与踩坑

### 2026-04-23 — multiprocessing spawn 子进程 cwd PermissionError

- **症状**：worker 进程启动即崩，父进程报 `EOFError`
- **根因**：spawn 模式 `os.chdir()` 到父进程 cwd（Lustre 目录），容器 root 没权限
- **解法**：跑命令前 `cd /tmp`
- **提醒**：EOFError 时先找 worker 端真正错误
