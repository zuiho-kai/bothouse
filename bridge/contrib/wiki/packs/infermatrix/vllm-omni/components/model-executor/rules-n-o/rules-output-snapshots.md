---
name: rules-output-snapshots
description: "Async output snapshot 规则 EXEC-SNAPSHOT-1a（PR #8213，PackedOutputSnapshot 按 dtype/device 分组的 slab 重用条件、producer_event 与 slot 复用、host slab 每 output 自有）与 EXEC-SNAPSHOT-1b（PR #8473，AR 输出 inline 与 background 路径的 scheduler / sample / query-start metadata 寿命，跳过 payload 工作的四个条件）"
metadata:
  scope: 只收异步输出打包的 storage 所有权与 inline/background 元数据寿命两条规则；async Omni output materialization 的 output-cycle 合同 EXEC-5a 归 model-executor-rules-3，request-end payload 延迟 D2H 的 EXEC-1g 归 rules-bridge-batch-1，输出类型与字段合同归 rules-output-contract
---
# Async output snapshot 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-output-snapshots.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8213
- [EXEC-SNAPSHOT-1a] 打包异步输出必须保留 producer 与 consumer 的 storage 所有权
  - 触发：修改PackedOutputSnapshot、dtype/device slab grouping、reuse_existing_storage或跨stream D2H。
  - 强制：按dtype/device分组保持pytree/shape/requestorder；只有contiguous leaves共享同storage且offset连续匹配copyplan才可重用slab。slot复用需等上一consumer，copy stream需等producer_event；host slab每output自有。quantized/非strided走原per-tensorfallback。
  - 验收：dtype/device混合、empty/非contiguous/quantizedfallback、错offset、reuseon/off、独立producerstream、延迟D2H与后续slotoverwrite都覆盖，retainedhostoutput仍与原snapshot逐值一致。 ^[PR #8213]
- [EXEC-SNAPSHOT-1b] Inline 与 background AR 输出必须分别遵守元数据寿命
  - 触发：修改 AR output materialization、query_start_loc CPU metadata、pooler hidden payload 或异步后处理 snapshot。
  - 强制：先决定输出是否 background；background 路径独立复制下一步会改写的 scheduler、sample/logprob/prompt-logprob/nan 与 query-start metadata，inline 在下一步开始前完成可借用当前 view。只有 hidden 关闭、无有效 multimodal payload、无 prefix-cache 工作、无待执行 model postprocess 时才跳过 payload 工作；已由 bookkeeping detach 的 request IDs/index map 不重复复制。
  - 验收：延迟 background consumer 同时推进下一步、inline/background 对照、token-only CosyVoice、prefix-cache/postprocess 路径和 retained output 各回归，结果与未优化路径一致。 ^[PR #8473]

## 决策与踩坑

- [EXEC-SNAPSHOT-1a] 禁止：把mutablegraph/slotview当owned snapshot；省略producerevent或在D2H完成前复用device；为打包改变dtype、request归属或叶子数值；已有ownedpacked输出再做重复GPUcopy。
- [EXEC-SNAPSHOT-1b] 禁止：把 inline 可借用的 buffer带入 background；只看 include_hidden 就跳过 prefix cache 或 postprocess；以少一次 copy 换取请求/长度错配。
