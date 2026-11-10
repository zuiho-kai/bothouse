---
name: serving-architecture
description: OpenAI beam serving 架构：serving_engine、serving_models、beam_search_patch、beam_proc_manager 的职责、data flow、Direct review map 与 validation
metadata:
  scope: 只收 serving owner 的职责边界、入口文件、数据流、review map 和验证要求；入口说明归 serving-overview
---
# OpenAI beam serving architecture

## 现状

### Responsibilities and boundary

- OpenAI-facing beam request and response handling, BeamProc startup, API-server final delivery, metrics and cancellation.

### Data flow

- Serving creates beam requests and communicates with EngineCore.
- The BeamProc manager owns executable startup and readiness; serving consumes engine/BP results and turns them into API responses.
- Request cancellation, iterator failure and terminal result cleanup must retain their user-visible behavior.

## 关键事实

- 源页：`knowledge/repos/vllm-gr/components/serving/architecture.md`（InferMatrixCopilot@ecfb84d0）；title: OpenAI beam serving architecture；type: architecture；tags: vllm-gr, serving；created: 2026-09-30；updated: 2026-09-30
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/entrypoints/openai/serving_engine.py
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/entrypoints/openai/serving_models.py
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/entrypoints/openai/beam_search_patch.py
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/entrypoints/openai/beam_proc_manager.py

### Source and entrypoints

- `vllm_gr/entrypoints/openai/serving_engine.py`
- `vllm_gr/entrypoints/openai/serving_models.py`
- `vllm_gr/entrypoints/openai/beam_search_patch.py`
- `vllm_gr/entrypoints/openai/beam_proc_manager.py`

### Direct review map

- Read `serving_engine.py` for request ownership, beam result consumption, final cleanup and metrics; `beam_search_patch.py` for upstream API signatures and streaming delegation; `serving_models.py` and `beam_proc_manager.py` for native process startup.
- Check stream options, error and cancellation paths against the supported vLLM version rather than an unrelated installed release.
- Focused tests: `tests/test_serving_beam_lifecycle.py`, `tests/test_serving_models_beamproc_startup.py`, `tests/test_prometheus_beam_search_metrics.py`.

### Validation

- Use the target head's declared dependency versions and test selectors.
- Bind evidence to that head; a missing native build or incompatible environment is a validation gap.
- See the [[serving-overview]]（owner entry） and [[components-overview]]（component map） for neighboring boundaries.
