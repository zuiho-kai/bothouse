---
name: attention-architecture
description: Beam attention runtime 架构：beam_attn_metadata / beam_attn_gpu 的职责、data flow、Direct review map 与 validation
metadata:
  scope: 只收 attention owner 的职责边界、入口文件、数据流、review map 和验证要求；入口说明归 attention-overview
---
# Beam attention runtime architecture

## 现状

### Responsibilities and boundary

- GPU/NPU beam attention execution and the metadata that describes ordinary, prefix and suffix query/cache layouts.

### Data flow

- Metadata partitions standard and beam queries and supplies cache geometry.
- GPU attention evaluates standard queries and prefix/suffix beam attention, merges their states and writes into the caller-owned output.
- Platform and FlashAttention-version branches can have different shape and ownership contracts.

## 关键事实

- 源页：`knowledge/repos/vllm-gr/components/attention/architecture.md`（InferMatrixCopilot@ecfb84d0）；title: Beam attention runtime architecture；type: architecture；tags: vllm-gr, attention-runtime；created: 2026-09-30；updated: 2026-09-30
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/v1/attention/backends/beam_attn_gpu.py
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/v1/attention/backends/beam_attn_metadata.py

### Source and entrypoints

- `vllm_gr/v1/attention/backends/beam_attn_gpu.py`
- `vllm_gr/v1/attention/backends/beam_attn_metadata.py`

### Direct review map

- Read `vllm_gr/v1/attention/backends/beam_attn_metadata.py` for query indices and cache geometry, then `beam_attn_gpu.py` for prefix/suffix kernels, LSE layouts and output writes.
- Check ordinary and grouped queries, supported FlashAttention versions, causal suffix lengths and caller output ownership.
- Inspect platform-specific peers before extending a GPU conclusion to NPU.
- Focused tests: `tests/test_beam_attention_metadata.py`.

### Validation

- Use the target head's declared dependency versions and test selectors.
- Bind evidence to that head; a missing native build or incompatible environment is a validation gap.
- See the [[attention-overview]]（owner entry） and [[components-overview]]（component map） for neighboring boundaries.
