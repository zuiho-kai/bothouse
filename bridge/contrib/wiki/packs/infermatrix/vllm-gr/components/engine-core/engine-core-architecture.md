---
name: engine-core-architecture
description: EngineCore beam scheduling 架构：core.py、engine_core_patch.py、wire.py 的职责、data flow、Direct review map 与 validation
metadata:
  scope: 只收 engine-core owner 的职责边界、入口文件、数据流、review map 和验证要求；入口说明归 engine-core-overview
---
# EngineCore beam scheduling architecture

## 现状

### Responsibilities and boundary

- Python EngineCore admission, beam state and cache ownership, scheduler replies, and the CE side of the BeamProc wire boundary.

### Data flow

- EngineCore patches register GR request types, initialize beam state before upstream startup, and start CE I/O at most once.
- Engine outputs go to BeamProc; returned beam plans enter the scheduler before newer API input.
- Child creation, aborts and terminal cleanup belong to the EngineCore scheduler.

## 关键事实

- 源页：`knowledge/repos/vllm-gr/components/engine-core/architecture.md`（InferMatrixCopilot@ecfb84d0）；title: EngineCore beam scheduling architecture；type: architecture；tags: vllm-gr, scheduler；created: 2026-09-30；updated: 2026-09-30
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/v1/engine/core.py
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/v1/engine/engine_core_patch.py
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/v1/engine/wire.py

### Source and entrypoints

- `vllm_gr/v1/engine/core.py`
- `vllm_gr/v1/engine/engine_core_patch.py`
- `vllm_gr/v1/engine/wire.py`

### Direct review map

- Read `vllm_gr/v1/engine/core.py` for plan application, child admission, wire encoding and terminal cleanup.
- Read `engine_core_patch.py` for initialization and shutdown ownership, and `wire.py`/`types.py` for the registered request contract.
- Follow the live CE-to-BP sender and BP-to-CE reply path together; transport changes also touch the BeamProc owner.
- Focused tests: `tests/test_beam_request_unit.py`, `tests/test_beamproc_scheduler_unit.py`.

### Validation

- Use the target head's declared dependency versions and test selectors.
- Bind evidence to that head; a missing native build or incompatible environment is a validation gap.
- See the [[engine-core-overview]]（owner entry） and [[components-overview]]（component map） for neighboring boundaries.
