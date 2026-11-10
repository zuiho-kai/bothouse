---
name: components-overview
description: vLLM-GR component map：按 source owner 选 engine-core、beam-proc、serving、attention、packaging 及各自 source scope
metadata:
  scope: 只收源目录 repos/vllm-gr/components 索引页的使用时机、边界和 owner 入口表；各 owner 的细节归其 overview 与 architecture 页
---
# vLLM-GR components

## 现状

### When to use this entry

- Select the stable source owner for a GR runtime or packaging change.

### Outside this map

- Repository identity and supported versions belong to the [[vllm-gr-overview]]（repository entry）; generic procedures belong to general review（源链接 `../../../general/review/_index.md`，不在本 pack 内）.

## 关键事实

- 源页：`knowledge/repos/vllm-gr/components/_index.md`（InferMatrixCopilot@ecfb84d0）；title: vLLM-GR component map；type: index；tags: vllm-gr, components；created: 2026-09-30；updated: 2026-09-30；sources: 无

### Contents

- Task：EngineCore beam scheduling
  - Entry：[[engine-core-overview]]（engine-core）
  - Source scope：`vllm_gr/v1/engine/`
- Task：Rust BeamProc runtime
  - Entry：[[beam-proc-overview]]（beam-proc）
  - Source scope：`rust/beam-proc/`
- Task：OpenAI beam serving
  - Entry：[[serving-overview]]（serving）
  - Source scope：`vllm_gr/entrypoints/`
- Task：Beam attention runtime
  - Entry：[[attention-overview]]（attention）
  - Source scope：`vllm_gr/v1/attention/`
- Task：Native packaging and validation
  - Entry：[[packaging-overview]]（packaging）
  - Source scope：`setup.py`
