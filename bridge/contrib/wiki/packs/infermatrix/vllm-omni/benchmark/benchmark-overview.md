---
name: benchmark-overview
description: vLLM-Omni 性能与 Profiling 目录入口：按场景分流到 benchmark rules（BENCH-1f2、BENCH-1g、BENCH-1h）、guides、incidents、results 与 OmniInteract realtime guide，并说明 benchmarks/tts/model_configs.yaml 共享 TTS runner registry 的用法与 IndexTTS 2.5 条目的证据边界
metadata:
  scope: 只收 benchmark 目录的分流表、适用范围和共享 TTS runner registry 说明；规则正文归 benchmark-rules，指南清单归 benchmark-guides-overview，旧入口说明归 benchmark-notes，跨仓库通用的性能测试方法不放这里
---
# vLLM-Omni 性能与 Profiling

## 现状

### 什么时候查这里

- 跑 vLLM-Omni benchmark、profiling，或查询仓库内历史性能结果。

### 不放什么

- 跨仓库通用的性能测试方法。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 新增/审查 perf JSON、runner schema predicate、warmup 覆盖、realtime artifact、Hub dataset fallback、per-request timeout 或 `/v1/videos` 轮询预算、最终性能复测与控制漂移、startup/raw-load测量边界或archive baseline采样窗口 | [[benchmark-rules]]（benchmark rules） — BENCH-1f2、BENCH-1g、BENCH-1h。 |
| 查看旧 benchmark 总览 | [[benchmark-notes]]（overview） |
| 运行 AR graph、Hunyuan 或 MiniCPM-o Omni-DuplexEval benchmark | [[benchmark-guides-overview]]（benchmark guides） |
| 调查 profiling、模型加载和性能验证错误 | [[benchmark-incidents-overview]]（benchmark incidents） |
| 查询历史结果 | [[benchmark-results-overview]]（results） |
| 运行/审查 OmniInteract native-duplex serving benchmark（client ITL 优先，Stage-0 仅为无正 client ITL 的受限恢复） | [[omniinteract-realtime]]（OmniInteract realtime guide） |

- `benchmarks/tts/model_configs.yaml` 是共享 TTS runner registry；新模型在这里声明 model、deploy、voice/reference 与 workload，结果保留解析配置、seed、speed、并发和音频属性。IndexTTS 2.5 条目只证明 harness 可路由；没有 native 2.5 baseline 时不得声称性能等价。^[PR #5957]

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-10-09
- 来源（sources）：benchmarks/tts/bench_tts.py；benchmarks/tts/model_configs.yaml；PR #6522；PR #6634；PR #6818；vllm_omni/benchmarks/data_modules/omniinteract_dataset.py；vllm_omni/benchmarks/omniinteract.py；vllm_omni/benchmarks/patch/patch.py；tests/benchmarks/patch/test_patch.py
  - vllm_omni/benchmarks/duplex/；vllm_omni/entrypoints/cli/benchmark/omni_duplex_eval.py；vllm_omni/experimental/fullduplex/client.py
