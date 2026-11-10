---
name: mage-vl-rules
description: "Mage-VL 规则 MAGEVL-1a：experimental adapter 必须保持 trust_remote_code 加载、每 session 有界因果窗口与 gate、仅 text 加 encoded video 的 dedicated WebSocket、codec 缺 cv-preinfer 时 fail fast，且不得注册为 native vLLM 架构（PR #6537）"
metadata:
  scope: 只收 MAGEVL-1a 一条规则与代码快速入口；数据流归 mage-vl-architecture，名称范围与入口归 mage-vl-overview
---
# Mage-VL 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/mage-vl/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #6537；recipes/Microsoft/Mage-VL.md；examples/offline_inference/mage_vl/end2end.py；examples/online_serving/mage_vl/duplex_client.py；vllm_omni/experimental/fullduplex/mage_vl/adapter.py；vllm_omni/experimental/fullduplex/mage_vl/serving/backend.py
  - vllm_omni/experimental/fullduplex/mage_vl/serving/server.py；tests/e2e/features/fullduplex/test_mage_vl_adapter.py；tests/e2e/features/fullduplex/test_mage_vl_serving.py；tests/examples/offline_inference/test_mage_vl.py
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| experimental adapter、bounded duplex、codec backend 或 native-support claim | `MAGEVL-1a` |

### [MAGEVL-1a] experimental adapter 必须保持 remote-code、bounded duplex 与 non-native boundary

- 触发：Mage-VL loader/backend、adapter capability、visual window/gate flow、WebSocket protocol、codec backend、documentation/example 或 attempted registry/deploy/unified-route change。
- 强制：用 `AutoProcessor.from_pretrained(..., trust_remote_code=True)` 与 `AutoModelForCausalLM.from_pretrained(..., trust_remote_code=True)` 加载 checkpoint，并在 serving 前验证 StreamMind gate method。
  - mutable window、pending query/gate decision、dedup ID 与 gate task 必须 per-session isolation、bounded causal history，且拒绝 `window_size > max_windows`。production WebSocket 只接受 text 加 encoded video，并使用 dedicated `/v1/mage-vl/duplex`；
  - base64 video materialization 必须在全部 prepare failure/cancellation path cleanup。`codec` 必须在 `cv-preinfer` 缺失时 fail fast 并说明 `frames` fallback；backend GPU inference 与 cancellation/close 遵循 [[rules-session-lifecycle]]（SERV-6h）。
- 验收：CPU tests 覆盖 text+encoded-video、exact capability、bounded window、gate dedup、cross-session isolation、cancellation responsiveness、duplicate-session close code 4429、cleanup、codec missing-binary failure 与 frames fallback。
  - offline wrapper 必须验证 Mage checkout/media/dependencies，并构造 image、frame-video、codec-video 与 streaming reference command。未来 native registration 必须单独证明 real checkpoint processor/config compatibility、real vLLM execution 以及 registry/pipeline/deploy/unified-route validation。^[PR #6537]

## 决策与踩坑

- [MAGEVL-1a] 禁止：把 Mage-VL 注册为 Qwen3-VL 或任意 native vLLM architecture、写入 global `ModelRegistry`、增加 pipeline/deploy config，或宣称 unified route/ordinary `vllm serve` support；advertise 当前 Transformers transport 不接受的 image/opaque `codec_window`；
  - 把 RTX 4090 functional run 说成 benchmark、general performance 或 general hardware-support evidence。
