---
name: remote-debug-strategy
description: Remote Debug Strategy 入口：远端任务按场景（新机器侦察、serving fail-fast 与 cleanup、AR graph profiling、full pipeline benchmark）路由到专题页，加四条硬规则摘要（commit-push-pull 只是部署手段、复杂 Bash 先落脚本、先 fail-fast 再 sweep、共享机器低频状态文件）
metadata:
  scope: 只收远端调试的场景路由表与硬规则摘要，各专题的正文在表中所链页面；本页不放服务器地址与具体命令
---
# Remote Debug Strategy 入口

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/guides/remote-debug-strategy.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, remote；created: 2026-07-10；updated: 2026-07-10
- 本文件只保留路由。远端任务先按场景打开专题页，避免一次性载入全部 graph/profiling 复盘。

| 场景 | 读这个 |
|------|--------|
| 新机器/新模型侦察、HF cache、tmux/docker exec、减少 SSH 次数、issue 复现 | basics.md（源链接 `../../../../general/remote/guides/debug-basics.md`） |
| serving/benchmark 启动 gate、watchdog、cleanup、pytest/accuracy 归属清理 | serving_failfast_cleanup.md（源链接 `../../../../general/remote/guides/serving-failfast-cleanup.md`） |
| AR graph serve、comprehension gate、profiler config、trace quality、online start/stop | [[ar-graph-profiling-1]]、[[ar-graph-profiling-2]]、[[ar-graph-profiling-3]]（ar_graph_profiling.md） |
| full pipeline benchmark connector/指标 gate、AR graph tail-gap 诊断 | [[full-pipeline-benchmark]]（full pipeline benchmark） |

- 硬规则摘要：
  - git commit-push-pull 是部署手段，不是调试手段。
  - 远端复杂 Bash 命令先落脚本，并完整通过 canonical fail-closed 投递门禁（源链接 `../../../../general/remote/guides/debug-basics.md#远端-bash-脚本投递必须失败关闭`）；不复制弱化命令。
  - serving/benchmark 必须先 fail-fast，单请求 smoke 通过前不进 sweep。
  - 共享机器 graph/profiling 用一个控制会话和低频状态文件，不要密集 SSH 轮询。
