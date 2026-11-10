---
name: rules-qwen25-talker-eos
description: "Qwen2.5-Omni talker 终止 conditioning 规则 VLLM-OMNI-PR9371-QOMNI-TALKER-EOS（PR #9371）：stage_input_processors/qwen2_5_omni.py 的 thinker2talker_full_payload 传给 talker 的 conditioning 须对齐 HF 参考——附带 text-token embeddings 并补 terminal text-EOS 与 text-pad embedding，自然完成与 length-cap 截断两条路径都要覆盖；示例客户端默认不注入 seed/temperature"
metadata:
  scope: 只收 Qwen2.5-Omni thinker→talker 终止 conditioning 与示例客户端采样默认值的一条规则 VLLM-OMNI-PR9371-QOMNI-TALKER-EOS；cross-stage embedding buffer 的 ingress width（EXEC-1d，Qwen2.5 Talker 3584→896）归 rules-bridge-batch-1
---
# 模型执行器 — Qwen2.5-Omni talker 终止 conditioning 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-qwen25-talker-eos.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-26；updated: 2026-10-26
- 来源（sources）：PR #9371
- [VLLM-OMNI-PR9371-QOMNI-TALKER-EOS] Qwen2.5-Omni thinker→talker 终止 conditioning 必须对齐 HF 参考并覆盖截断
  - 触发：修改 `vllm_omni/model_executor/stage_input_processors/qwen2_5_omni.py` 的 `thinker2talker_full_payload`、`vllm_omni/model_executor/models/qwen2_5_omni/qwen2_5_omni.py` 中 talker 的 text/codec embedding conditioning，或 thinker 在 stop-token 完成与长度上限截断下的音频终止行为。
  - 强制：传给 talker 的 conditioning 与 HuggingFace 参考实现保持一致：在 thinker hidden states 之外附带对应 text-token embeddings，并在终止处补 terminal text-EOS 与 text-pad embedding；自然完成与 length-cap 截断两条路径都必须落到同一终止条件，保证音频输出干净结束。注意 AR runner 不为最后采样的 token 产生 hidden-state row，两条终止路径都要补齐该缺口。
  - 验收：CPU 级回归同时覆盖自然完成与强制截断（`tests/model_executor/models/qwen2_5_omni/test_qwen2_5_omni_talker_conditioning.py`、`tests/model_executor/stage_input_processors/test_qwen2_5_omni_thinker2talker.py`）；示例客户端单测断言默认请求中不含 seed/temperature、仅显式给定时转发；
    - 调用该示例的 e2e 用确定性采样（`--seed 42 --temperature 0`）加有界长度 prompt，并输出 finish_reason 辅助诊断。^[PR #9371]

## 决策与踩坑

- [VLLM-OMNI-PR9371-QOMNI-TALKER-EOS] 禁止：只把 raw thinker hidden states 喂给 talker 而缺少 terminal EOS/pad conditioning（缺陷表现为文本截断后接重复无意义音频尾）；只修 stop-token 完成路径而漏掉 length-cap 截断路径；共享示例客户端默认注入 seed/temperature 覆盖服务端采样行为。
