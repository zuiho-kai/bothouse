---
name: engine-core-overview
description: EngineCore beam scheduling 入口：admission、beam state 与 cache ownership、scheduler replies、CE 侧 BeamProc wire boundary、source scopes 与 focused tests
metadata:
  scope: 只收 engine-core owner 索引页的使用时机、source scopes、边界和 focused tests；数据流与 review map 归 engine-core-architecture
---
# EngineCore beam scheduling

## 现状

### When to use this entry

- Python EngineCore admission, beam state and cache ownership, scheduler replies, and the CE side of the BeamProc wire boundary.
- Source scopes: `vllm_gr/v1/engine/`, `vllm_gr/v1/core/`.

### Outside this owner

- Other source owners are listed in the [[components-overview]]（component map）; repository identity and version constraints belong to the [[vllm-gr-overview]]（repository entry）.

## 关键事实

- 源页：`knowledge/repos/vllm-gr/components/engine-core/_index.md`（InferMatrixCopilot@ecfb84d0）；title: EngineCore beam scheduling entry；type: index；tags: vllm-gr, scheduler；created: 2026-09-30；updated: 2026-09-30
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/v1/engine/core.py
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/v1/engine/engine_core_patch.py
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/v1/engine/wire.py

### Contents

- Task：Trace source, data flow and validation
  - Entry：[[engine-core-architecture]]（Architecture）
  - Purpose：Pinned source map and compact Direct review map
- Focused tests: `tests/test_beam_request_unit.py`, `tests/test_beamproc_scheduler_unit.py`.
