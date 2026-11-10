---
name: 2026-04-27-remote-ssh-slurm-container-05
description: 2026-04-27 远端错题，Windows 下 ControlMaster 不可用、ASKPASS 失败触发 fail2ban；改用系统 OpenSSH + key auth + 重试
metadata:
  scope: 只收 2026-04-27「Windows ControlMaster 不可用，ASKPASS 触发 fail2ban」这一次事故的症状、根因、解法和提醒；SSH 通用流程归 ssh-workflow
---
# 2026-04-27 — Windows ControlMaster 不可用，ASKPASS 触发 fail2ban

## 关键事实

- 源页：`knowledge/general/remote/incidents/2026-04-27-remote-ssh-slurm-container-05.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter（无 type / tags / created / updated / sources）
- 编号：`inc-2026-04-27-remote-ssh-slurm-container-05`
- 归属：`general/remote`
- 状态：已验证
- 搜索词：Windows ControlMaster 不可用，ASKPASS 触发 fail2ban
- 影响范围：general/remote

## 决策与踩坑

### 2026-04-27 — Windows ControlMaster 不可用，ASKPASS 触发 fail2ban

- **症状**：ControlMaster 报 `getsockname failed: Not a socket`；密码认证连续失败后被封禁
- **根因**：Windows Git Bash / OpenSSH ControlMaster 均不支持；WSL2 NAT 无法访问内网段；ASKPASS 失败触发 fail2ban
- **解法**：用 `/c/Windows/System32/OpenSSH/ssh.exe` + SSH key auth + 重试逻辑（5次×3s）；每次 SSH 打包多条命令
- **提醒**：服务器 `MaxStartups` 限制并发，快速连多次随机拒绝；key auth 不触发 fail2ban
