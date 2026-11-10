---
name: 2026-04-28-profiling-and-model-loading-16
description: 2026-04-28 错题：ssh 里执行 pkill -9 -f python 匹配到 SSH session 子进程，连接断开 exit code 255；清理只能按本轮 launcher PID/PGID
metadata:
  scope: 只收 2026-04-28 按进程名全局终止杀死 SSH session 这一起事故及按 PID/PGID 和归属证据清理的解法；显存残留 OOM 的清理归 2026-04-23-profiling-and-model-loading-02
---
# 2026-04-28 — pkill -f python 杀死 SSH session

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-28-profiling-and-model-loading-16.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-28-profiling-and-model-loading-16`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：pkill -f python 杀死 SSH session
- 影响范围：repos/vllm-omni/benchmark
- **症状**：`ssh ... "pkill -9 -f python; ..."` 执行后 SSH 断开，exit code 255
- **根因**：`pkill -f python` 匹配所有含 "python" 的进程，包括 SSH session 的子进程
- **解法**：启动时记录本轮 launcher PID/PGID；清理前验证 `/proc/<pid>/cwd`、command、owner 和进程组，只停止能够证明属于本轮的进程。按脚本名搜索仍可能命中其他用户任务，不能作为清理边界。
- **对未来的提醒**：远端禁止按进程名称做全局终止；没有本轮 PID/PGID 和归属证据时停止并报告。
