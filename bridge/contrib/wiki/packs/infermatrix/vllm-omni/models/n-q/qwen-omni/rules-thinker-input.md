---
name: rules-thinker-input
description: "Qwen3-Omni Thinker 输入规则：QOMNI-INPUT-1a MultiModalDataParser 显式 `audio_resample_method=pyav`（PR #8306）、QOMNI-INPUT-1b deepstack_input_embeds 在 meta-device 上下文中仍用 device_config.device 物化（PR #8461）"
metadata:
  scope: 只收 QOMNI-INPUT-1a 与 1b；Thinker MRoPE、audio encoder TP 与 PP 捕获规则归 qwen-omni-rules
---
# Qwen3-Omni Thinker 输入与 buffer 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen-omni/rules-thinker-input.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, qwen-omni；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8306；PR #8461
- [QOMNI-INPUT-1a] audio parser 必须显式选中模型验证过的 resampler
  - 触发：修改 Qwen3-Omni Thinker MultiModalDataParser 的 audio resampling。
  - 强制：模型 parser 显式设置 audio_resample_method="pyav"，避免 vLLM 默认 backend 变化改写长音频路径；采样率、长度与其他 parser 参数仍按原模型配置。
  - 验收：断言 parser 实际选择 PyAV，使用同长音频、原采样率与重采样目标复测 audio-input mean_e2el；短音频与非 audio control 保持。PR 本身只加 parser 参数，没有新增 regression test。^[PR #8306]
- [QOMNI-INPUT-1b] deepstack buffer 不能继承 ambient meta device
  - 触发：修改 Qwen3-Omni Thinker deepstack_input_embeds、禁用 vision tower 的构造或 buffer resize。
  - 强制：初始 torch.zeros 明确使用 vllm_config.device_config.device，保持期望 dtype 与 [levels,max_tokens,hidden] shape；后续 resize 沿已物化 buffer device，不受 surrounding no-init-weights/meta context 影响。
  - 验收：真实 meta initialization context 下覆盖 vision limit0/1与多个 token capacity；断言非meta、目标device/dtype/shape和零值，并在 resize后再次核对。^[PR #8461]

## 决策与踩坑

- [QOMNI-INPUT-1a] 禁止：为修复一个 audio-input regression 改全局 resampler、image/video pipeline 或 CI baseline；只依据 import 成功宣称质量/TTFP/RTF 改善。
- [QOMNI-INPUT-1b] 禁止：在 vision limit=0 时把未被权重 loader 替换的辅助 buffer 留在 meta；依赖环境默认 device，或只测试 vision-enabled 普通构造。
