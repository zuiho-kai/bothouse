---
name: rebase-overview
description: Rebase（对齐 upstream vLLM）入口：dev/vllm-align 分支、.buildkite/cuda/rebase-pipeline.yml、rebase-agent 仓库的分工，main @ 19da2382 与 vLLM v0.28.0 @ 2cf0a6915ce5 验证说明，及工作流与两页上游 API 漂移模式的分流
metadata:
  scope: 只收 rebase 目录的主题说明、边界与分流表；工作流归 rebase-workflow，API 漂移模式归 upstream-api-drift 与 upstream-api-drift-loading-1、upstream-api-drift-loading-2；单组件 bug、CI 结构与分支/PR 机制不在此目录
---
# Rebase（对齐 upstream vLLM）

## 现状

- 把 vllm-omni 对齐到新版 upstream vLLM 的周期性工作：专用分支 `dev/vllm-align`、专用管线 `.buildkite/cuda/rebase-pipeline.yml`（仓库 `main @ 19da2382`、upstream vLLM `v0.28.0 @ 2cf0a6915ce5` 验证）、专职自动化（rebase-agent 仓库——运营系统在那里，本主题只沉淀领域知识）。

### 什么时候查这里

- 做/排查 upstream 对齐（rebase、模块波次、API 漂移适配、对齐分支 CI）。

### 不放什么

- 单组件产品 bug → `components/<模块>/`；CI 结构与环境坑 → `ci/`；分支/PR 机制 → `git/`。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 工作流：分支、波次、模块→upstream 映射、失败路由 | [[rebase-workflow]]（workflow） |
| 上游 API 漂移模式（serving/调度/测试侧） | [[upstream-api-drift]]（upstream API drift） |
| 上游 API 漂移模式（权重/显存/运行时侧） | [[upstream-api-drift-loading-1]]、[[upstream-api-drift-loading-2]]（drift：加载与运行时） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/rebase/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, rebase；created: 2026-07-16；updated: 2026-09-04
- 来源（sources）：PR #6606；.buildkite/cuda/rebase-pipeline.yml；vllm-omni-rebase-agent@122a9468:agent/config.py
