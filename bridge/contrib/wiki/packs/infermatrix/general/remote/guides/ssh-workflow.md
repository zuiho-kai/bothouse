---
name: ssh-workflow
description: SSH 工作方式：先验证目标和 host key、最小只读探针、减少连接风暴、文件传输后核对路径大小 hash、Windows 上区分 OpenSSH / WSL / Git Bash 客户端
metadata:
  scope: 只收从本机到远端的 SSH 连接、认证、探针、连接频率、文件传输和 Windows 客户端注意事项；远端脚本投递门禁归 debug-basics-1，Slurm 资源归 srun-lifecycle
---
# SSH 工作方式

## 关键事实

- 源页：`knowledge/general/remote/guides/ssh-workflow.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, remote；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 1. 先验证目标和 host key

- 连接信息以完整 `user@host:port` 为单位记录在 ignored `local/remote.md`。首次连接前从管理员、云控制台或其他可信通道核对 host key fingerprint；不要为了省事关闭 host key 校验。
- 优先使用：
  - OpenSSH key + `ssh-agent`；
  - 组织提供的证书或 SSO；
  - 已配置的 `Host` alias 和固定 `IdentityFile`。
- 密码只通过交互式 SSH 或组织批准的凭据工具输入，不写进脚本、环境文件、命令历史或仓库。

### 2. 最小只读探针

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 <host-alias> \
  'hostname && id && pwd -P'
```

- `<host-alias>` 必须来自已验证的本机 SSH 配置。探针失败时先区分 DNS、路由、host key、认证和服务端拒绝，不连续暴力重试。

### 3. 减少连接风暴

- 每次连接合并少量相关只读检查；
- 使用短超时；
- 认证失败或服务端限流后暂停，确认原因再重试；
- ControlMaster 只在当前平台和网络明确支持时使用；
- 长任务使用远端状态文件和日志，不高频轮询。

### 4. 文件传输

- 优先使用 `scp`、`sftp`、`rsync` 或仓库 Git 流程。传输后核对目标绝对路径、大小和 hash；不要用嵌套 shell/base64 命令绕过正常传输工具，除非环境明确限制且内容不敏感。

### 5. Windows 注意事项

- 先确认实际调用的是 Windows OpenSSH、WSL SSH 还是 Git Bash SSH；三者的配置目录、agent 和网络路径可能不同。出现连接差异时记录 `Get-Command ssh` 或 `command -v ssh`，不要混用不同客户端的结论。
