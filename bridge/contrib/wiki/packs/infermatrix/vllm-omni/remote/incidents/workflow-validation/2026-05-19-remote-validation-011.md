---
name: 2026-05-19-remote-validation-011
description: "2026-05-19 错题：PR #3606 远端性能验证中 PowerShell here-string 投递脚本出现 $VENV 本地展开、远端脚本 0 字节、UTF-8 BOM 导致 shebang 失败三连坑，含无 BOM 落盘检查与 nohup 后 tail 日志确认"
metadata:
  scope: 只收 2026-05-19 PowerShell→SSH 投递脚本三连坑这一起事故及落盘检查解法；改默认用 base64 投递归 2026-05-20-remote-validation-017
---
# 2026-05-19 — PowerShell 到 SSH 投递脚本：变量展开 / 空文件 / BOM 三连坑

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/workflow-validation/2026-05-19-remote-validation-011.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-remote-validation-011`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：PowerShell 到 SSH 投递脚本：变量展开 / 空文件 / BOM 三连坑
- 影响范围：repos/vllm-omni/remote
- **症状**：跑 PR #3606 远端性能验证时，第一次通过 PowerShell heredoc 投递 `/tmp/run_pr3606_eval.sh`，远端脚本变成 0 字节；另一次脚本首行带 UTF-8 BOM，远端报 `/tmp/run_pr3606_eval.sh: line 1: ﻿#!/usr/bin/env: No such file or directory`。之前还出现过 `$VENV` 被本地 PowerShell 展开，导致远端脚本拿不到期望变量。
- **根因**：
  - PowerShell 双引号 / here-string 会在本地先展开 `$VENV`、`$()` 等内容。
  - Windows 写文本默认可能带 BOM；bash 把 BOM 当作 shebang 前的不可见字符。
  - 只看 `nohup ... & echo $!` 只能说明 shell 接受了命令，不说明脚本内容正确或程序已启动。
- **解法**：
  1. 复杂远端脚本优先本地生成无 BOM 文件，或用单引号 here-string，并在远端落盘后立刻检查：

     ```powershell
     @'
     #!/usr/bin/env bash
     set -euo pipefail
     echo "$VENV"
     '@ | ssh ... 'cat > /tmp/run_x.sh && perl -i -pe "s/^\xEF\xBB\xBF//" /tmp/run_x.sh && chmod +x /tmp/run_x.sh && wc -c /tmp/run_x.sh && sed -n "1,40p" /tmp/run_x.sh'
     ```

  2. 后台启动后必须短 sleep + tail 日志确认已经进入程序日志，而不是只看 PID：

     ```bash
     nohup bash /tmp/run_x.sh > /tmp/run_x.log 2>&1 < /dev/null &
     echo $! > /tmp/run_x.pid
     sleep 5
     tail -80 /tmp/run_x.log
     ```

- **怎么避免**：
  1. PowerShell→SSH→bash 链路中，任何 `$VAR` 都默认有本地展开风险；能单引号就单引号，不能单引号就转义。
  2. 远端脚本启动前固定三连：`wc -c`、`sed -n '1,40p'`、`bash -n`。
  3. 看到日志 0 字节或没有程序首行 marker，先修脚本投递，不要继续分析模型 / venv / profiler。
