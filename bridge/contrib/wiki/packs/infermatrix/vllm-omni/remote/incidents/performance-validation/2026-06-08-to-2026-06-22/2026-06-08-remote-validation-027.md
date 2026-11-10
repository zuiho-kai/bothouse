---
name: 2026-06-08-remote-validation-027
description: 2026-06-08 错题：AR graph profiling 重跑时把 VLLM_CACHE_ROOT 指到新的 $OUT/vllm_cache，AsyncOmniEngine 初始化 1872.69 秒、torch.compile 628.31 秒（复用 cache 约 38 秒）；含 cache_cold 标注、启动耗时拆分与 Startup Breakdown 模板
metadata:
  scope: 只收 2026-06-08 重跑新建 cache root 制造 cold compile 这一起事故；graph 运行被复杂化的整体问题归 2026-06-08-remote-validation-005
---
# 2026-06-08 — AR graph profiling 重跑时新建 cache root，制造 10 分钟 cold compile

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-08-remote-validation-027.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-08-remote-validation-027`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：AR graph profiling 重跑时新建 cache root，制造 10 分钟 cold compile
- 影响范围：repos/vllm-omni/remote
- **症状**：用户要求按 online `/start_profile` -> 请求 -> `/stop_profile` 重新跑 AR graph profiling。服务最终跑通并产出 1.2GB/rank trace，但启动耗时 `AsyncOmniEngine initialized in 1872.69 seconds`，其中 `torch.compile took 628.31 s`。此前同口径 graph 复用 cache 时 compile 约 38 秒。
- **根因**：为了让每轮 artifact 自包含，我把 `VLLM_CACHE_ROOT` 指到了新的 `$OUT/vllm_cache`。这改变了启动口径，触发 cold torch compile，和用户质疑的“别人 2 分钟启动、你 15 分钟启动”混在一起，增加了机时消耗和解释成本。
- **硬规则**：
  1. graph serve / profiling 的 `VLLM_CACHE_ROOT` 必须写进 `$OUT/scope.txt`，并标注 `cache_cold=true/false`。
  2. 已有成功 graph run 的 cache 可用时，正式重跑默认复用该 cache；只有需要验证 cold start 时才新建 cache root。
  3. 启动耗时汇报必须拆开：权重加载、torch.compile、CUDA graph capture、engine init、API startup。不能只报一个总 ready 时间。
  4. 用户关注 request-window trace 时，不要为 artifact 整洁牺牲启动口径；trace、日志、scope 可以单独打包，compile cache 不必进 artifact。
- **正确处理模板**：

```text
Startup Breakdown
- cache root:
- cache cold: yes/no
- weight loading:
- torch.compile:
- graph capture:
- engine init:
- API ready:

Trace Window
- start_profile:
- request start/end:
- stop_profile:
- trace files:
```
