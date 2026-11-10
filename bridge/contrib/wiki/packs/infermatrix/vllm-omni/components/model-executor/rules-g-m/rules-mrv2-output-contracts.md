---
name: rules-mrv2-output-contracts
description: "MRv2 shared output 规则 EXEC-MRV2-1a 至 EXEC-MRV2-1c（PR #8184）：FULL graph auxiliary output 须显式声明稳定 tensor tree（supports_mrv2_full_graph_aux_outputs、make_omni_output_mrv2）、narrow sampler 的 logits_vocab_size 同步与 embed.sampled 只按有效行发布、generation 输出保持真实 scheduler 请求 ID、exact input token 数与完成 D2H 的 host 数据"
metadata:
  scope: 只收 MRv2 的 aux output tree、narrow sampler / sampled embedding 与 generation 输出三条规则；attention capture 边界归 rules-attention-capture，optional codec 归 rules-mrv2-optional-codec，非 MRv2 的 Omni 输出类型合同 EXEC-7* 归 rules-output-contract
---
# MRv2 shared output 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-mrv2-output-contracts.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8184
- [EXEC-MRV2-1a] FULL graph auxiliary output 必须显式声明稳定 tensor tree
  - 触发：修改 supports_mrv2_full_graph_aux_outputs、tuple output capture/replay、make_omni_output_mrv2 或模型 stage hooks。
  - 强制：只有声明且返回 tuple 的模型进入 FULL aux path；每个非空 pytree leaf 都是 tensor，leading dimension 与 hidden token axis 一致，所有 capture 的 tree spec 稳定，否则明确拒绝。capture 临时 wrapper/aux flag 在 finally 恢复；replay unflatten 后用本步 live batch/request state 生成输出，保留 real-token 与 padded-token 的切片边界。
    - 未声明 tuple/捕获 side-state 继续排除 FULL；外层 stage wrapper 必须暴露子模块有效 hooks，遗漏有 warning。
  - 验收：稳定嵌套树、非tensor/空/错 token-axis、跨 capture spec 变化、eager/FULL/padded batch 与 live metadata 改变都覆盖，异常后原 forward/flag 恢复。 ^[PR #8184]
- [EXEC-MRV2-1b] Narrow sampler 与 sampled embedding 发布必须按实际模型和有效行投影
  - 触发：修改 custom sampler、logits_vocab_size、identity decode preprocessing 或 embed.sampled handoff。
  - 强制：模型已声明的 narrow head 在 sampler 构造前同步 runner/request-state/warmup vocab；custom sampler 或 static staged-write shortcut 仅按显式 hook/capability。identity decode 跳过仅限非 eager-MTP 的 decode 行。sampled embedding 仅给 async non-text multimodal handoff；
    - 一步必须每请求一枚 sample，未完成 prefill 的行留空，最后 prefill/有效 decode 行才取 model embedding；copy stream 等 producer event 后嵌套合并，不能覆盖其他 payload。speculative 多 sample 不走此发布。
  - 验收：narrow/no-declared vocab、custom/default sampler、partial/final prefill、mixed rows、multi-sample 与异步 producer stream分别回归，token/embedding 请求顺序和其他 payload 不变。 ^[PR #8184]
- [EXEC-MRV2-1c] Generation 输出必须保持真实请求 ID、精确 token 数和完成的 host 数据
  - 触发：修改 generation runner request-owned cache、requires_exact_input_shape、V1 batched D2H 或 sparse conditioning。
  - 强制：requires_request_ids 的模型接收本步 scheduler ID、按 batch 顺序；声明 exact input 的 MRv2 generation eager 路径检查实际 input token 数等于 scheduled 数，错配拒绝，dummy run 不套用。V1 pinned CUDA 输出逐项 nonblocking copy 后全步一次同步，未 pinned/非CUDA保留 blocking；返回前 host 完整。
    - per-row tensor/list cardinality 不可改变，None payload 保留区别，稀疏 conditioning 的 None 表示无更新并跳过。
  - 验收：异长、batch>1、真实 ID reorder、exact-shape mismatch、dummy/control、pinned/unpinned/CPU 与 delayed D2H 覆盖，对旧逐项 copy 检查字段和数值一致。 ^[PR #8184]

## 决策与踩坑

- [EXEC-MRV2-1a] 禁止：把任意 Python/request metadata 捕入 graph；重放过期 prefill payload；容忍变化的 aux tree 或把 padding 发布给真实请求；模型没有 opt-in 就默认改用新 hook。
- [EXEC-MRV2-1b] 禁止：用 HF 大词表覆盖 codec head；给 partial prefill 发布丢弃 sample；无条件复用 upstream/custom sampler staged-write 生命周期；把 embed.sampled 优化说成所有模型性能保证。
- [EXEC-MRV2-1c] 禁止：给每行合成固定/占位 ID；把 padded input 给按每请求 seq count 切分的模型；发布尚未完成 D2H 的 host tensor；把 None 归一为 {} 或丢失请求位置。
