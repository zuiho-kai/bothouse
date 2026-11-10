---
name: rules-attention-capture
description: "MRv2 attention capture 边界规则 EXEC-ATTN-BOUND-1a（PR #8422）：OmniModelState.prepare_attn 在 capture 时把 mixed FULL 的 query bound 提升到 token bucket 最坏情况、separate decode 保持 uniform bound，传给 multimodal embedding 的 query_start_loc_np 只取当前 num_reqs + 1 个 boundary；验收要求真实 FA3 的 FULL_AND_PIECEWISE / FULL_DECODE_ONLY capture 与 replay"
metadata:
  scope: 只收 MRv2 attention capture metadata 与 request boundary 的一条规则 EXEC-ATTN-BOUND-1a；MRv2 aux tree、narrow sampler 等输出合同归 rules-mrv2-output-contracts，missing codec attribute 归 rules-mrv2-optional-codec
---
# MRv2 attention capture 边界规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-attention-capture.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8422
- 置信度（confidence）：high
- [EXEC-ATTN-BOUND-1a] capture query bound 必须区分 mixed FULL 与 separate decode
  - 触发：修改 MRv2 `OmniModelState.prepare_attn` 的 capture metadata、CUDA graph mode 或 multimodal embedding 的 request boundaries。
  - 强制：仅在 capture、没有显式 `max_query_len` 且 graph mode 不使用 separate routine 时，把 mixed FULL 的 bound 提升到 token bucket 的最坏情况；separate decode 保持其 uniform query bound，已有显式 bound 和 runtime metadata 保持原语义。传给 multimodal embedding 的 `query_start_loc_np` 只取当前 `num_reqs + 1` 个 boundary。
  - 验收：真实 FA3 覆盖 `FULL_AND_PIECEWISE`/`FULL_DECODE_ONLY` 的 capture 与 replay，并分别断言 mixed worst-case、uniform decode 和显式 bound；mixed multimodal batch 断言只读取当前请求边界。CPU shape/stub 检查不能替代 kernel replay。^[PR #8422]

## 决策与踩坑

- [EXEC-ATTN-BOUND-1a] 禁止：用 capture dummy 的平均每行长度约束 mixed replay；把 separate decode 的 FA3 GQA capture 扩成 bucket query；把预分配 boundary array 的旧尾部作为当前 request。
