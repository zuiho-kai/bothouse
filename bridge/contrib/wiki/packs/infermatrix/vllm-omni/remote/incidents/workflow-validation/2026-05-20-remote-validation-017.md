---
name: 2026-05-20-remote-validation-017
description: "2026-05-20 错题：复现 issue #3743 时仍用 PowerShell here-string 管道创建 /tmp/repro3743_server.sh 得 0 字节，改用 UTF-8 bytes → base64 → 远端 decode 投递"
metadata:
  scope: 只收 2026-05-20 PowerShell→SSH 高风险投递默认用 base64 这一起事故及硬规则；首次三连坑记录归 2026-05-19-remote-validation-011
---
# 2026-05-20 — PowerShell→SSH 投递脚本已知高风险时，默认用 base64

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/workflow-validation/2026-05-20-remote-validation-017.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-20-remote-validation-017`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：PowerShell→SSH 投递脚本已知高风险时，默认用 base64
- 影响范围：repos/vllm-omni/remote
- **症状**：同一轮复现里，明明已有规则要求远端脚本落盘后 `wc -c` + `sed` + `bash -n`，我仍用 PowerShell here-string 管道到 SSH 创建 `/tmp/repro3743_server.sh`，结果脚本变成 0 字节。随后才改用 base64 投递，脚本正常落盘并启动服务。
- **根因**：
  - 只记住了“落盘后检查”，没有把高风险链路的默认投递方式改掉。
  - PowerShell 管道 / quoting / `$!` 展开风险在这台慢远端上每失败一次都放大成本。
- **解法**：复杂脚本默认本地 UTF-8 bytes → base64 → 远端 decode：

```powershell
$script = @'
#!/usr/bin/env bash
set -euo pipefail
...
'@
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
ssh ... "echo $b64 | base64 -d > /tmp/run_x.sh; chmod +x /tmp/run_x.sh; wc -c /tmp/run_x.sh; sed -n '1,80p' /tmp/run_x.sh; bash -n /tmp/run_x.sh"
```

- **硬规则**：
  - PowerShell→SSH 的多行脚本默认 base64 投递；普通 heredoc/管道只允许用于一次性、无变量、无后台进程的小片段。
  - `wc -c` 输出为 0 时，立即停止当前方向；不要继续启动、不要解释模型/venv。
  - 涉及 `$!`、`$VENV`、here-doc、后台 pid 的命令，必须保证这些变量在远端 shell 展开，而不是 PowerShell 本地展开。
