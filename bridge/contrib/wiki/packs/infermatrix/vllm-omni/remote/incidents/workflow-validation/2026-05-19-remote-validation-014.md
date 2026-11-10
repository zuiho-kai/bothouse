---
name: 2026-05-19-remote-validation-014
description: "2026-05-19 错题：PR #3606 分支已强推到 bddc12a5a、远端已有 wt-pr3606-base / wt-pr3606-patch，新终端仍跑大量探测命令重新 discover；改写 5 行 runbook 与聚合 probe 脚本、远端冷启动 checklist"
metadata:
  scope: 只收 2026-05-19 新终端远端冷启动重复 discover 这一起事故及 runbook 与聚合探测解法；远端路径不能猜归 2026-05-19-remote-validation-012，节点路径记忆归 2026-05-20-remote-validation-015
---
# 2026-05-19 — 新终端远端冷启动太慢：不要把已有上下文重新 discover 一遍

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/workflow-validation/2026-05-19-remote-validation-014.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-remote-validation-014`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：新终端远端冷启动太慢：不要把已有上下文重新 discover 一遍
- 影响范围：repos/vllm-omni/remote
- **症状**：PR #3606 分支已经强推到 `bddc12a5a`，远端也已有 `<REMOTE_WORK_ROOT>/wt-pr3606-base` 和 `<REMOTE_WORK_ROOT>/wt-pr3606-patch` 两个现成 worktree。但新终端上来后先跑了大量探测命令（find repo、find venv、grep profiler、grep Omni、查 deploy yaml、查历史脚本等），中间还因为 PowerShell 管道 CRLF 误判文档路径不存在。最后才复用现成 base/patch 目录并启动 tmux 长跑测试。
- **根因**：
  - 新终端没有先消费当前会话/issue/PR 已知事实，把远端当全新机器重新侦察。
  - 远端 SSH 单次往返很慢，19 条小命令比 1 个聚合 probe 脚本贵很多。
  - PowerShell 直接管道到 `ssh bash -s` 时 CRLF/quoting 会制造假阴性，让“路径不存在”这类判断变脏。
- **解法**：
  1. 新终端接手前先写 5 行 runbook：目标 PR/branch/head、远端 worktree、venv、输出目录、当前长跑 tmux/session。
  2. 如果已有 worktree / 脚本 / 输出目录，先 `git -C <dir> status` + `git -C <dir> rev-parse HEAD` 验证，不要 `find /home /root` 全盘扫。
  3. discovery 必须聚合成一个无 BOM/LF 脚本，一次 SSH 返回完整事实；禁止 10+ 条一行 SSH 慢慢摸。
  4. 用户/上个终端已经给出“PR branch 已强推到 <sha>”时，直接围绕这个 sha 同步，不要重新推导 branch 状态。
- **怎么避免**：
  1. 远端冷启动 checklist：

     ```text
     Known head: <sha>
     Known worktrees: <base>, <patch>
     Known venv: <venv>
     Known tmux/output: <session>, <out_dir>
     Next action: sync/check/run/poll
     ```

  2. 任何“路径不存在”的结论都要先排除 CRLF/BOM/本地变量展开；用 `printf %q` / `ls -ld` / `test -d` 的聚合脚本确认。
  3. 远端慢时优先复用现有目录和脚本；只有现有事实冲突时才扩大搜索范围。
