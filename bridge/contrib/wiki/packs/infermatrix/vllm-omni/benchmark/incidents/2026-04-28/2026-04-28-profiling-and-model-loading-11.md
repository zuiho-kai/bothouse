---
name: 2026-04-28-profiling-and-model-loading-11
description: 2026-04-28 错题：HF 模型的 apply_rotary_pos_emb 在 position_ids=None 时广播把 key 扩到 22800，SDPA 报 key.size(1) 与 value.size(1) 不等
metadata:
  scope: 只收 2026-04-28 AR decode CFG unconditional 路径 RoPE 广播导致 SDPA 报错这一起事故及 cos/sin 截断解法；修完后出现的 2D attention_mask 报错归 2026-04-28-profiling-and-model-loading-12
---
# 2026-04-28 — HF 模型 RoPE 广播导致 SDPA key/value size 不匹配

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-28-profiling-and-model-loading-11.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-28-profiling-and-model-loading-11`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：HF 模型 RoPE 广播导致 SDPA key/value size 不匹配
- 影响范围：repos/vllm-omni/benchmark
- **症状**：`RuntimeError: Expected key.size(1) == value.size(1) to be true, but got false`，发生在 AR decode 阶段的 CFG unconditional 路径
- **根因**：`apply_rotary_pos_emb` 在 `position_ids=None` 时，cos/sin shape `[1, max_pos_emb, head_dim]` 通过广播把 key 从 `[1,32,1,128]` 扩到 `[1,32,22800,128]`，但 value 没过 RoPE 保持 `[1,32,1,128]`
- **解法**：在 `apply_rotary_pos_emb` 里加截断：`position_ids is None` 时 `cos = cos[..., :q.size(-2), :]`
- **对未来的提醒**：RoPE 函数里 cos/sin 和 q/k 的 seq_len 维度必须对齐，广播会静默扩张 tensor
