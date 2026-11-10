---
name: rules-xpu-eager-pins
description: 规则 VLLM-OMNI-PR8853-XPU-EAGER-PINS：qwen3_tts.yaml 仅 stage_id 1、audio8_tts.yaml 仅 stage_id 0 的 platforms.xpu enforce_eager pin 保持 stage 级 scope 并与 Level Zero 原因注释对应，Intel 支持标记以 Arc Pro B70、vLLM v0.31.0 运行记录为证据，按 CONF-3a 完整展开链验收
metadata:
  scope: "只收 PR #8853 的 XPU eager pin 与 Intel 支持标记一条规则；platform overlay 的通用合同（PLAT-1a）归 rules-platform-overlays，CONF-3a 的展开链归 configuration-rules-3"
---
# XPU eager pins 与 Intel 支持验证

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-xpu-eager-pins.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-10-13；updated: 2026-10-13
- 来源（sources）：PR #8853
- [VLLM-OMNI-PR8853-XPU-EAGER-PINS] XPU 图捕获 pin 保持 stage 级 scope，经完整展开链验收
  - 触发：修改 `vllm_omni/deploy/qwen3_tts.yaml`、`vllm_omni/deploy/audio8_tts.yaml` 的 `platforms.xpu` overlay（含其中的 stage 级 `enforce_eager` pin 与原因注释），或增改 `docs/models/supported_models.md` 中模型的 Intel 支持标记。
  - 强制：PR #8853 在两份 YAML overlay 中建立的 pin 保持 stage 精确 scope 并与原因注释一一对应——Qwen3-TTS 仅 `stage_id: 1`（注释：Level Zero cannot capture the Code2Wav graph）、Audio8 仅 `stage_id: 0`（注释：Level Zero cannot record Fast-AR sampling）；`qwen3_tts.yaml` 的 `xpu` overlay 既有 `model_runner: v1` 等字段保持不变。
    - 触碰这些 overlay 的改动不得破坏 pin↔stage_id↔注释三者的对应关系。Intel 支持标记必须以真实 Intel 硬件与 vLLM 版本的运行记录为证据；本 PR 的记录是 Arc Pro B70、vLLM v0.31.0 上 JoyAI-Image-Edit、Qwen-Image-2.1、Kandinsky 6 零源码改动通过。
  - 验收：按 [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（CONF-3a） 的完整链 `resolve_deploy_yaml → load_deploy_config → merge_pipeline_deploy → build_stage_runtime_overrides` 展开，断言 XPU 下 Qwen3-TTS 的 stage 1 与 Audio8 的 stage 0 在最终逐 stage 配置中生效 `enforce_eager: true`。
    - PR #8853 的证据只到两份 YAML 的 overlay 层，未展示其他 stage 展开后的生效值；因此凡改动同 overlay 中其他 stage 或其他平台字段的 PR，必须自行给出展开后受影响 stage 的生效值。每处 pin 的原因注释仍与 stage_id 对应；新增 Intel ✅ 的模型行附硬件与 vLLM 版本的验证记录。^[PR #8853]

## 决策与踩坑

- [VLLM-OMNI-PR8853-XPU-EAGER-PINS] 禁止：在 overlay 层面把 pin 扩大到其他 stage、整个模型、其他平台，或改成平台级 eager 默认；删除或改写与 stage 对应的原因注释；未在 Intel 硬件验证就添加 ✅；把这两处捕获缺陷外推为 XPU 所有 graph 不可捕获，或据此要求其他 XPU stage/模型默认 eager；以原始 YAML 单层读取代替展开后配置的验证。
