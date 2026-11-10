---
name: rules-mimo-audio-device
description: "MiMo-Audio 设备与平台支持规则 VLLM-OMNI-PR8654-MIMO-DEVICE（PR #8654）：mimo_audio_llm.py 的 base_local_forward 与 local_forward 的 tokens_device 默认值必须用 torch.accelerator API 推导（无加速器才回退 cpu）且两处一致，不得硬编码 cuda: 前缀；docs/models/supported_models.md 中 MiMoAudioModel 平台勾选（本 PR 为 Intel GPU）须与设备推导对应"
metadata:
  scope: 只收 MiMo-Audio 本地 token 默认设备与平台勾选的一条规则 VLLM-OMNI-PR8654-MIMO-DEVICE；MiMo fused thinker/talker 的 SupportsPP 委托 EXEC-2i 归 rules-loader-contract，各平台 runner/backend 合同归 rules-platform-backends-1、rules-platform-backends-2
---
# MiMo-Audio 设备与平台支持

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-mimo-audio-device.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-23；updated: 2026-10-23
- 来源（sources）：PR #8654
- [VLLM-OMNI-PR8654-MIMO-DEVICE] MiMo-Audio 本地 token 默认设备必须加速器无关
  - 触发：修改 `vllm_omni/model_executor/models/mimo_audio/mimo_audio_llm.py` 中 `base_local_forward` 或 `local_forward` 的 `tokens_device` 默认参数，或修改 `docs/models/supported_models.md` 中 `MiMoAudioModel` 行的硬件平台勾选。
  - 强制：`tokens_device` 默认值必须以 `torch.accelerator.is_available()` 做可用性门控，并用 `torch.accelerator.current_accelerator().type` 与 `torch.accelerator.current_device_index()` 拼接设备字符串，仅在无加速器时回退 `cpu`；`base_local_forward` 与 `local_forward` 两处默认表达式必须保持一致。
    - 为 `MiMoAudioModel` 勾选新硬件列（本 PR 为 Intel GPU）时，必须确认设备推导已按上述方式做到加速器无关。
  - 验收：在 diff 中逐行核对两个签名的默认设备表达式一致且不含硬编码后端名；supported_models.md 中 MiMo-Audio 的平台勾选与设备推导实际支持的加速器后端一一对应。^[PR #8654]

## 决策与踩坑

- [VLLM-OMNI-PR8654-MIMO-DEVICE] 禁止：在这两个默认参数里硬编码 `"cuda:"` 前缀并用 `torch.cuda.is_available()` 门控——在 XPU 等非 CUDA 加速器上该默认值会静默解析为 `cpu`，使 embedding 查找偏离模块所在设备；不得把通用 accelerator API 与硬编码后端前缀混用。
