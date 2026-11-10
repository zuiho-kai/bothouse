---
name: 2026-04-23-profiling-and-model-loading-02
description: 2026-04-23 错题：tp4_fp8 跑完立即跑 tp2_sp2 时 GPU 显存未释放导致 OOM，解法是按本轮 launcher PID/PGID 停进程组并确认 GPU 释放
metadata:
  scope: 只收 2026-04-23 连续跑多配置显存残留 OOM 这一起事故的症状、根因和解法；pkill -f python 杀死 SSH session 的事故归 2026-04-28-profiling-and-model-loading-16
---
# 2026-04-23 — 连续跑多配置时 GPU 显存残留 OOM

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-23-profiling-and-model-loading-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-23-profiling-and-model-loading-02`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：连续跑多配置时 GPU 显存残留 OOM
- 影响范围：repos/vllm-omni/benchmark
- **症状**：tp4_fp8 跑完立即跑 tp2_sp2，OOM
- **根因**：进程退出后 GPU 显存未立即释放
- **解法**：每轮记录 launcher PID/PGID；结束时先验证 cwd、command 和 owner，再仅停止本轮进程组，最后用 GPU 状态确认本轮资源已释放。禁止按名称全局终止进程。
