---
name: attention-overview
description: Beam attention runtime 入口：GPU/NPU beam attention、metadata layouts、source scope vllm_gr/v1/attention/ 与 focused tests
metadata:
  scope: 只收 attention owner 索引页的使用时机、source scopes、边界和 focused tests；数据流与 review map 归 attention-architecture
---
# Beam attention runtime

## 现状

### When to use this entry

- GPU/NPU beam attention execution and the metadata that describes ordinary, prefix and suffix query/cache layouts.
- Source scopes: `vllm_gr/v1/attention/`.

### Outside this owner

- Other source owners are listed in the [[components-overview]]（component map）; repository identity and version constraints belong to the [[vllm-gr-overview]]（repository entry）.

## 关键事实

- 源页：`knowledge/repos/vllm-gr/components/attention/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Beam attention runtime entry；type: index；tags: vllm-gr, attention-runtime；created: 2026-09-30；updated: 2026-09-30
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/v1/attention/backends/beam_attn_gpu.py
- 来源（sources）：JiusiServe/vllm-gr@a05103dc16c7b8dfd2213b73c5ee2d4f28cb6fee:vllm_gr/v1/attention/backends/beam_attn_metadata.py

### Contents

- Task：Trace source, data flow and validation
  - Entry：[[attention-architecture]]（Architecture）
  - Purpose：Pinned source map and compact Direct review map
- Focused tests: `tests/test_beam_attention_metadata.py`.
