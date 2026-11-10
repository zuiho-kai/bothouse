---
name: indextts2-rules
description: "IndexTTS2 request-end payload 规则 ITTS2-1a（PR #8478）：S2Mel 整段 latent 必须在 request end 交付，2.0 latent 与 2.5 code-only 都设 omni_pooler_payload_include_hidden=False 与 omni_payload_at_request_end=True，禁止每 step 复制 S2Mel 不读的 pooler hidden；含 Direct 代码快速入口"
metadata:
  scope: 只收 ITTS2-1a 的触发、强制、禁止与验收；talker 与 S2Mel 的数据流归 indextts2-architecture，2.5 版的 bundle、speed、S2Mel batching 规则归 indextts-2-5-rules
---
# IndexTTS2 request-end payload 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/indextts2/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8478

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| generic pooler hidden、request end、latent/code-only、S2Mel payload | `ITTS2-1a` | `vllm_omni/model_executor/models/indextts2/indextts2_talker.py::IndexTTS2TalkerForConditionalGeneration` → `vllm_omni/model_executor/stage_input_processors/indextts2.py::talker2s2mel_full_payload` |

### [ITTS2-1a] S2Mel 的整段 latent 必须在 request end 交付

- 触发：修改IndexTTS2Talker的genericpoolerhidden、request-endbuffer或talker2s2mel_full_payload。
- 强制：2.0 latent与2.5code-only均设置omni_pooler_payload_include_hidden=False、omni_payload_at_request_end=True。latent从hidden_states.latent、codes从codes.mel及meta交付；request-endGPU累积沿共享owned-device-snapshot合同，并保持code/latent同长。
- 验收：两代×use_gpt_latent控制断言flags与实际consumerfields；snapshot/accumulate/cancel/reorder、同长非空latent、no-latent及prefix-cachematerialization保持。性能/ASR结论需同commit同deployment独立复测。 ^[PR #8478]

## 决策与踩坑

- [ITTS2-1a] 禁止：每step复制S2Mel不读的pooler hidden；把去掉generic hidden解释为去掉alignedlatent；在request end前交付截断整段或混合request；把旧v0.28benchmark当currentmain复测。
