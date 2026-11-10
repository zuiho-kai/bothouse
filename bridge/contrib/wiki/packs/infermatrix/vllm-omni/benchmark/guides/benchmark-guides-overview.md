---
name: benchmark-guides-overview
description: vLLM-Omni 性能指南分流表：AR graph profiling / gap / d-step、remote validation gates、evidence gate、grouped DiT、benchmark scope、full pipeline、performance evidence、dynamic batching、divergent path、plan and validation、OmniInteract realtime、Omni-DuplexEval 共 14 篇指南的场景到页面对照
metadata:
  scope: 只收 benchmark/guides 目录按场景查指南的对照表；各指南正文归表中所指页面，benchmark 目录级分流归 benchmark-overview，规则归 benchmark-rules
---
# vLLM-Omni 性能指南

## 现状

| 遇到什么 | 查看哪里 |
|---|---|
| 运行 AR graph serving/profiling | [[ar-graph-profiling-1]]、[[ar-graph-profiling-2]]、[[ar-graph-profiling-3]]（AR graph profiling） |
| 调查 AR graph step gap | [[ar-graph-gap-analysis]]（AR graph gap） |
| 调查 AR d-step 性能 | [[ar-dstep-investigation]]（AR d-step） |
| 固定远端性能与精度验证时间门禁 | [[remote-validation-gates]]（remote validation gates） |
| 判断旧 artifact 是否能支持本次结论 | [[evidence-gate]]（evidence gate） |
| 证明 step-batching 真正命中 grouped DiT | [[grouped-dit-benchmark]]（grouped DiT benchmark） |
| 固定 vLLM-Omni benchmark 口径 | [[benchmark-scope-1]]、[[benchmark-scope-2]]（benchmark scope） |
| 运行完整 pipeline 前确认 connector | [[full-pipeline-benchmark]]（full pipeline benchmark） |
| 判断性能和精度证据等级 | [[performance-evidence-1]]、[[performance-evidence-2]]（performance evidence） |
| 验证动态或连续 batching | [[dynamic-batching-validation]]（dynamic batching） |
| 验证分叉执行路径 | [[divergent-path-validation]]（divergent path） |
| 查看旧 plan/validation 总入口 | [[plan-and-validation]]（plan and validation） |
| 复现或审查 OmniInteract realtime serving runner | [[omniinteract-realtime]]（OmniInteract realtime） |
| 生成、评分或审查 MiniCPM-o Omni-DuplexEval artifact | [[omni-duplex-eval]]（Omni-DuplexEval） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/guides/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-09-06
- 来源（sources）：PR #6522；PR #6634；vllm_omni/benchmarks/data_modules/omniinteract_dataset.py；vllm_omni/benchmarks/omniinteract.py；vllm_omni/benchmarks/duplex/
