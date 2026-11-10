---
name: performance-validation-overview
description: "远端性能验证错题对照表：2026-05-19 至 2026-06-22 共 20 起 benchmark、profiling 与性能证据错题（fail-fast、unavailable 指标、AR profiler、graph profiling 失控、PR #4041、LTX2.3 性能看护、Hunyuan cache）的标题和对应页"
metadata:
  scope: 只收 performance-validation 源索引页的错题标题到错题页对照表；每起错题的症状、根因、解法在表中所列各页（2026-05-19-remote-validation-013 至 2026-06-22-remote-validation-032），上一级错题表归 remote-incidents-overview
---
# 远端性能验证错题

## 现状

| 错题 | 查看哪里 |
|---|---|
| 2026-05-19 — 测旧 PR 前先做 base commit venv/ABI smoke，别直接跑完整 profiling | [[2026-05-19-remote-validation-013]]（查看） |
| 2026-06-01 — 远端 benchmark 脚本没有 fail-fast | [[2026-06-01-remote-validation-019]]（查看） |
| 2026-06-01 — Full IT2I benchmark 的 unavailable 指标 | [[2026-06-01-remote-validation-020]]（查看） |
| 2026-06-02 — Benchmark 需求被脑补成 PR3938 对比 | [[2026-06-02-remote-validation-021]]（查看） |
| 2026-06-02 — AR-only 已有成功脚本却手写 runner | [[2026-06-02-remote-validation-022]]（查看） |
| 2026-06-02 — AR profiler 改变初始化语义 | [[2026-06-02-remote-validation-023]]（查看） |
| 2026-06-02 — AR benchmark 没复用成功 runbook | [[2026-06-02-remote-validation-024]]（查看） |
| 2026-06-05 — PR #4041 远端验证执行失控 | [[2026-06-05-remote-validation-025]]（查看） |
| 2026-06-05 — 共享机器 graph profiling 失控 | [[2026-06-05-remote-validation-026]]（查看） |
| 2026-06-08 — 用 bounded smoke 替代正式 trace | [[2026-06-08-remote-validation-003]]（查看） |
| 2026-06-08 — 无界 profiler 杀 worker | [[2026-06-08-remote-validation-004]]（查看） |
| 2026-06-08 — AR graph 调试把多条路径混排 | [[2026-06-08-remote-validation-005]]（查看） |
| 2026-06-08 — 重跑时新建 cache root | [[2026-06-08-remote-validation-027]]（查看） |
| 2026-06-12 — AR graph 重跑前没锁口径 | [[2026-06-12-remote-validation-028]]（查看） |
| 2026-06-12 — AR graph d-step 分析失控 | [[2026-06-12-remote-validation-029]]（查看） |
| 2026-06-15 — PR #4041 跑错 workload | [[2026-06-15-remote-validation-002]]（查看） |
| 2026-06-16 — LTX2.3 性能看护多次跑偏 | [[2026-06-16-remote-validation-030-1]]、[[2026-06-16-remote-validation-030-2]]（查看） |
| 2026-06-17 — PR #4041 复盘落盘位置错误 | [[2026-06-17-remote-validation-001]]（查看） |
| 2026-06-17 — LTX2.3 baseline 被半冷口径带偏 | [[2026-06-17-remote-validation-031]]（查看） |
| 2026-06-22 — Hunyuan e2e 未先证明 cache 可复用 | [[2026-06-22-remote-validation-032]]（查看） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/_index.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter
