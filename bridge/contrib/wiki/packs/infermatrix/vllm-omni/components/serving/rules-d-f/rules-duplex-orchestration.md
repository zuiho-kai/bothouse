---
name: rules-duplex-orchestration
description: "Serving duplex 编排两条规则：SERV-6g orchestrator streaming segment 的 finished / token_ids / output_metadata 按 stage_id 隔离、new_prompt_len_snapshot 保持 request-level（PR #6529）；SERV-6k PersonaPlex / Nemotron 等 model-specific harness 与 open message 共享同一个由 DuplexSessionRuntimeConfig 派生的 DuplexOutputBuffer（PR #8489）"
metadata:
  scope: 只收 SERV-6g 与 SERV-6k；SERV-6a–6f 的 full-duplex prewarm、CFG companion 与 capability gate 归 rules-engine-lifecycle-2，per-session 输出有界投递（SERV-DUPLEX-OUT-1a–1c）归 rules-duplex-output-delivery
---
# Serving duplex 编排规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-duplex-orchestration.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-05；updated: 2026-10-06
- 来源（sources）：PR #6529；vllm_omni/engine/orchestrator.py；tests/engine/test_orchestrator_segment_stage_keying.py；tests/engine/test_orchestrator_stage_input_bridge.py；PR #8489
- 置信度（confidence）：high
- [SERV-6g] orchestrator streaming segment state 必须按 stage key 隔离
  - 触发：orchestrator streaming state、stage metrics、final-output routing、next-stage bridge 或 duplex output context 修改。
  - 强制：每个 stage 独立拥有 `finished`、`token_ids` 与 `output_metadata`；写入和所有 consumer 都以显式 `stage_id` 选择该 slot，未上报的 stage 返回 fresh empty state，不能共享 mutable metadata。`new_prompt_len_snapshot` 仍是 request-level，因为它只由不按 stage 读取的 input-bridge context 消费。
  - 验收：多 stage 交错上报 boundary，逐 stage 验证 metrics、final-output、bridge 与 duplex context 只见自身 token/metadata；覆盖 missing-stage fresh state 与不会经过 raw-output loop 的 diffusion branch。^[PR #6529]
- [SERV-6k] model-specific duplex harness 必须共享同一有界输出 buffer
  - 触发：修改 `OpenDuplexSessionMessage` 合同、generic Harness字段或PersonaPlex/Nemotron harness。
  - 强制：从manager使用的同一 `DuplexSessionRuntimeConfig` 派生max_pending_output_bytes/events，创建单个 `DuplexOutputBuffer`，将同一object传给open message和Harness供event drain；构造扩展后的Harness用显式keywords，保持production `output_buffer` 必填。
  - 验收：generic与两model-specific runner suites使用相同公开open/drain合同，旧代码重现fixture error/失败后修复通过；核对正常events与teardown，test-only修复不证明新模型或全transport能力。原source在同allocation A/B得到64通过；目标CI证据仍须按真实source/hardware单独资格化。^[PR #8489]

## 决策与踩坑

- [SERV-6g] 禁止：用 request-global flat segment slot 让 diffusion/raw-output poll 覆盖另一 stage；调用 duplex context 时省略 stage ID；把 request-level prompt-length snapshot 误迁入 stage slot。
- [SERV-6k] 禁止：将required参数改成optional/default来掩盖stale tests；open和drain使用不同buffer，或复制一套与manager不一致的limits；用旧positional field顺序让queue/buffer错位。
