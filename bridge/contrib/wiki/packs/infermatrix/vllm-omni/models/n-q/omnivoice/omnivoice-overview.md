---
name: omnivoice-overview
description: OmniVoice（离散扩散 TTS）目录入口：Qwen3 backbone 对 8 个 codebook 做 32 步迭代 unmask 与 24 kHz DAC 解码、AR registry OmniVoiceModel 与 diffusion registry OmniVoicePipeline 双注册、单 stage DIFFUSION 的 pipeline key omnivoice、omnivoice.yaml 的 float32 与 enforce_eager 默认值、未决的 AR 入口走向
metadata:
  scope: 只收名称、双注册、pipeline 结构与部署默认值、审查入口；生成器热路径、request batch 与 instructions 校验的规则正文归 omnivoice-rules
---
# OmniVoice

## 现状

- 以下结构事实在 `main @ ca6b4e21` 复核；模型热路径的可执行门禁见 [[omnivoice-rules]]（OmniVoice rules；源锚点 #direct-代码快速入口）。

### 名称与范围

- 离散扩散 TTS：Qwen3 backbone 对 8 个 codebook 做 32 步迭代 unmask, HiggsAudioV2 风格 RVQ/DAC 解码到 24 kHz。
- **双注册**：AR registry `OmniVoiceModel`（`model_executor/models/omnivoice/`）; diffusion registry `OmniVoicePipeline`（别名 `OmniVoice`, `diffusion/models/omnivoice/pipeline_omnivoice.py`,post `get_omnivoice_post_process_func`）。
- pipeline key `omnivoice` 是**单 stage DIFFUSION** 包装（`execution_type=DIFFUSION`,`model_arch="OmniVoicePipeline"`）——与多数单 stage diffusion 家族不同,它在 `OMNI_PIPELINES` 里有显式入口。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）、`vllm_omni/utils/speaker_cache`。

### 结构与 serving

- diffusion pipeline 直接 import AR 目录的 `OmniVoiceGenerator`/`OmniVoiceDecoder`/`RuleDurationEstimator`,一次 `forward()` 完成文本→unmask→8-codebook token→DAC 解码;可选 `transformers.HiggsAudioV2TokenizerModel` import 有 guard。
- `omnivoice_generator.py` 带 `_OmniVoiceCUDAGraphForward`;无 stage_input_processor（单 stage 无交接）。packed QKV、Q/K RMSNorm + RoPE、GQA broadcast、SwiGLU packed activation、residual threading 及其 eager fallback 的边界见 `OMNIVOICE-1a`。
- deploy `omnivoice.yaml` 未 pin checkpoint;`enforce_eager`、`dtype: float32`、`distributed_executor_backend: mp`。
- 该部署默认值仍为 float32；PR #6317 的 CUDA 测试仅狭义覆盖 fp16/bf16 热路径，不改变默认值，也不构成其他硬件、shape 或 serving 的支持声明。
- **未决**：AR-registry 入口 `OmniVoiceModel` 何时被走到无法仅从源码判定（服务路径是单 DIFFUSION stage,docstring 暗示两 stage LLM_AR 形态）—— 断言其是否使用前需 live 验证。另注:`OmniVoice` 只是架构别名,不是独立变体。

### 什么时候查这里

- 审查 omnivoice 的双注册、unmask 步数/codebook 或 speaker cache 改动。
- 审查 fused projection loading、Q/K/V + gate/up packing、QK norm/RoPE、GQA、SwiGLU、residual、mask dtype、CUDA graph 或 Triton fallback 时先看 `OMNIVOICE-1a`；共享固定输入/TF32 约束见 [[rules-runtime-hot-paths]]（EXEC-9a；源锚点 #exec-9a-omnivoice-热路径的固定输入缓存与掩码精度边界）。
- 共享 RNG/graph 规则见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion rules）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/omnivoice/_index.md`（InferMatrixCopilot@ecfb84d0）；title: OmniVoice（离散扩散 TTS,AR/diffusion 双注册）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-22
- 来源（sources）：PR #6317；vllm_omni/model_executor/models/omnivoice/；vllm_omni/model_executor/models/omnivoice/omnivoice_generator.py；vllm_omni/model_executor/models/omnivoice/fused_qkv_rope.py；vllm_omni/diffusion/models/omnivoice/；vllm_omni/deploy/omnivoice.yaml
