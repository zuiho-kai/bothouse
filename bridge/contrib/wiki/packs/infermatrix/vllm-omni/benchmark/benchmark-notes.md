---
name: benchmark-notes
description: "Benchmark Notes 旧入口页：HunyuanImage3 AR 2025-04-17 对齐结论与 AR graph online 2026-06-09/06-12 结果的入口表，PR #6634 的 Omni-DuplexEval CLI（generate、evaluate、summarize）入口，PR #6404 的 Daily-Omni pack-mode 兼容测试不构成 benchmark 结果的说明"
metadata:
  scope: 只收旧 benchmark 总览页的入口表与两条 PR 说明；目录分流归 benchmark-overview，Omni-DuplexEval 合同归 omni-duplex-eval，具体结果归 ar-2025-04-17 与 ar-graph-online-2026-06-09-overview
---
# Benchmark Notes

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/overview.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-09-05
- 来源（sources）：PR #6404；PR #6634；vllm_omni/benchmarks/data_modules/daily_omni_dataset.py；vllm_omni/benchmarks/duplex/；vllm_omni/entrypoints/cli/benchmark/omni_duplex_eval.py；vllm_omni/experimental/fullduplex/client.py
- 本页只做 benchmark 入口。通用口径在 `general/benchmark/`，仓库指南和结果由本目录 `_index.md` 分流，避免单个文档继续膨胀。

| 文档 | 内容 |
|------|------|
| [[ar-2025-04-17]]（ar_2025_04_17.md） | 2025-04-17 HunyuanImage3 AR HF baseline vs vLLM-Omni 对齐 benchmark 结论 |
| [[ar-graph-online-2026-06-09-overview]]（AR graph online 结果） | 2026-06-09/06-12 HunyuanImage3 AR graph online perf、trace、patch 对照和 PR 证据口径 |

### Omni-DuplexEval

- PR #6634 introduced one installed CLI with `generate`、`evaluate` and `summarize` subcommands for MiniCPM-o native-duplex artifacts. Its dataset, media-clock, scoring-protocol and evidence contracts are documented in the [[omni-duplex-eval]]（Omni-DuplexEval guide）. ^[PR #6634]
- 具体 PR 的临时复测、讲解稿和 PR body 数据不再作为长期 benchmark 文档保留。这里仅路由可跨 PR 复用的 workload、口径、artifact 和诊断经验。
- Daily-Omni 的 pack-mode 兼容测试随 PR #6404 调整，但没有新增 registry、pipeline 或 benchmark 结果；video frame-to-unit pairing 是 Realtime client/Stage 0 correctness contract，而不是新的 benchmark metric 或性能结论。^[PR #6404]
