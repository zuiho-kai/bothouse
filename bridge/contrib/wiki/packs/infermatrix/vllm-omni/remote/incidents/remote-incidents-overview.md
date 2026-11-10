---
name: remote-incidents-overview
description: vLLM-Omni 远端验证错题对照表：2026-04-27 至 2026-05-18 五起远端运行时 / GPU / 依赖错题（Siglip2VisionModel、vLLM 0.21 依赖、TP=2 helper cleanup、GPU 占用三件套、scheduler API 漂移）的标题与对应页，以及性能验证与流程验证两个子目录入口
metadata:
  scope: 只收 remote/incidents 源索引页的错题标题到错题页对照表；每起错题的症状、根因、解法在表中所列错题页，性能验证错题归 performance-validation-overview，SSH 投递与环境发现错题归 workflow-validation-overview
---
# vLLM-Omni 远端验证错题

## 现状

| 错题 | 查看哪里 |
|---|---|
| 2026-04-27 — Siglip2VisionModel 版本不兼容 (transformers 5.6.2) | [[2026-04-27-remote-runtime-gpu-01]]（2026-04-27-remote-runtime-gpu-01） |
| 2026-05-18 — vLLM-Omni main 升到 vLLM 0.21 后只装 vllm 本体不够 | [[2026-05-18-remote-runtime-gpu-02]]（2026-05-18-remote-runtime-gpu-02） |
| 2026-05-18 — 跑 TP=2 要避开测试 helper 的全局 GPU cleanup/占卡假设 | [[2026-05-18-remote-runtime-gpu-03]]（2026-05-18-remote-runtime-gpu-03） |
| 2026-05-18 — GPU 占用判断只看 memory.used 漏了潜伏中的别人进程 | [[2026-05-18-remote-runtime-gpu-04]]（2026-05-18-remote-runtime-gpu-04） |
| 2026-05-18 — 端到端 smoke 撞 vllm scheduler API 漂移，单测能过但真跑崩 | [[2026-05-18-remote-runtime-gpu-05]]（2026-05-18-remote-runtime-gpu-05） |
| benchmark、profiling 和性能证据错题 | [[performance-validation-overview]]（performance validation） |
| SSH 投递、环境发现和普通执行错题 | [[workflow-validation-overview]]（workflow validation） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/_index.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter
