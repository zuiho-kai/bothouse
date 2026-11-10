---
name: beam-proc-architecture
description: Rust BeamProc runtime 架构：main.rs、io_worker.rs、beam_worker.rs 的职责、data flow、Direct review map 与 validation
metadata:
  scope: 只收 beam-proc owner 的职责边界、入口文件、数据流、review map 和验证要求；入口说明归 beam-proc-overview
---
# Rust BeamProc runtime architecture

## 现状

### Responsibilities and boundary

- Rust BeamProc process, worker queues, beam decisions, and the BP side of CE and API-server communication.

### Data flow

- The process owns worker and I/O managers.
- I/O decodes CE messages, dispatches them to beam workers and publishes plans or final results.
- CE replies and API-server final-result delivery are distinct channels.
- Changes to native CE transport must also inspect the live Python caller and the CE wire contract.

## 关键事实

- 源页：`knowledge/repos/vllm-gr/components/beam-proc/architecture.md`（InferMatrixCopilot@ecfb84d0）；title: Rust BeamProc runtime architecture；type: architecture；tags: vllm-gr, distributed；created: 2026-09-30；updated: 2026-09-30
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:rust/beam-proc/src/worker/io_worker.rs
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:rust/beam-proc/src/worker/beam_worker.rs
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:rust/beam-proc/src/main.rs

### Source and entrypoints

- `rust/beam-proc/src/worker/io_worker.rs`
- `rust/beam-proc/src/worker/beam_worker.rs`
- `rust/beam-proc/src/main.rs`

### Direct review map

- Read `rust/beam-proc/src/main.rs` for process startup and shutdown; `worker/io_worker.rs` for framing, worker routing and result delivery; `worker/beam_worker.rs` for beam state, selection and terminal output.
- Inspect the pinned `rust/Cargo.toml` and lockfile before using native dependency APIs.
- Review the enabled transport path and partial-startup cleanup separately from the default path.
- Focused tests: `tests/test_beamproc_scheduler_unit.py`.

### Validation

- Use the target head's declared dependency versions and test selectors.
- Bind evidence to that head; a missing native build or incompatible environment is a validation gap.
- See the [[beam-proc-overview]]（owner entry） and [[components-overview]]（component map） for neighboring boundaries.
