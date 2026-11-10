---
name: rules-custom-op-dispatch
description: "Diffusion 规则 DIFF-1ae：CustomOp 在 XPU 上仍分派到 forward_xpu，基类 forward_xpu 委托 forward_native，forward_cuda 保持 NotImplementedError；保留 qwen3_code_predictor._RotaryEmbedding.forward_xpu；BAGEL-7B-MoT 与 Z-Image-Turbo 的 4-card XPU 证据（PR #5568）"
metadata:
  scope: 只收 vllm_omni/diffusion/layers/custom_op.py 的平台分派默认行为这一条规则；attention/backends 的 AttentionImpl.forward_xpu 不在本页范围
---
# Diffusion CustomOp dispatch 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-custom-op-dispatch.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #5568；vllm_omni/diffusion/layers/custom_op.py；tests/diffusion/layers/test_custom_op.py；vllm_omni/model_executor/models/common/qwen3_code_predictor.py
- 置信度（confidence）：high
- [DIFF-1ae] XPU CustomOp 默认分派必须回落 `forward_native`，但不得抹平非同义 backend 路径
  - 触发：修改 `CustomOp` 的平台分派/默认 backend 方法，或为 shared diffusion `CustomOp` 增删 XPU override。
  - 强制：`dispatch_forward()` 在 XPU 上仍绑定 `forward_xpu`；基类 `forward_xpu(*args, **kwargs)` 必须直接委托 `forward_native(*args, **kwargs)`，以使没有专用 XPU kernel 的 op 可走 PyTorch-native 路径。`forward_cuda` 仍须保持 `NotImplementedError`，不得因 XPU fallback 而掩盖缺失 CUDA 实现。
    - 仅删除与 `forward_native` 在参数和语义上完全等价的 subclass delegation override。
  - 验收：CPU 上直接调用的 base-class 测试须断言 native-only op 的 `forward_xpu` 与 `forward_native` 相等、`forward_cuda` 仍抛 `NotImplementedError`，并断言 `MoTRMSNorm` 没有 subclass override 时可通过继承 fallback 处理带/不带 index 的调用。
    - PR 报告的有界 XPU 证据为 4-card Intel XPU 上 BAGEL-7B-MoT（1024x1024、30 steps、layer-wise offload、TP=1）由失败变为 84s 完成，以及 Z-Image-Turbo（25 steps、CPU offload、TP=1）82s 通过；这些运行不构成全部 XPU/custom-op 的兼容性清单或性能承诺。^[PR #5568]

## 决策与踩坑

- [DIFF-1ae] 禁止：把 XPU 当作自动直达 `forward_native` 而绕过 platform dispatch；将此 fallback 改为 CUDA kernel fallback，或删除承担不同实现语义的 override。特别是 `qwen3_code_predictor._RotaryEmbedding.forward_xpu` 必须保留：它选择缓存的 cos/sin lookup，而 `forward_native` 进行 on-the-fly HF-reference math。
  - `attention/backends/` 的 `AttentionImpl.forward_xpu` 不属于本规则的清理范围。
