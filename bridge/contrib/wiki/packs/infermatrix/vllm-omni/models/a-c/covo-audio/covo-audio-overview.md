---
name: covo-audio-overview
description: Covo-Audio-Chat（腾讯，main @ 5d44868e 源码派生页）：三个 AR 架构别名映射同一类、pipeline key covo_audio 的 fused_thinker_talker → code2wav 两 stage（stop 151645）、token2wav.py 的 DiT 风格 token→wav 与两种交接、树内 speaker_prompt npy 资产、stage 1 强制 float32 与 enforce_eager 的原因（BigVGAN fp32 权重、code2wav 的 GPU→CPU 同步）
metadata:
  scope: 只收 Covo-Audio 的名称、stage 拓扑、结构与 serving 约束和查阅时机；本模型目前只有这一页，没有规则页或运行经验页
---
# Covo-Audio

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页,尚无本模型的运行经验沉淀）。

### 名称与范围

- 正式名称 Covo-Audio-Chat（腾讯;deploy 不 pin checkpoint,**三个架构别名映射同一个类、同一变体——无真实变体**）。AR registry 三个别名 `CovoAudioForCausalLM`/`CovoAudioForConditionalGeneration`/`CovoAudioModel` 映射同一类,另有 `CovoAudioLLMModel`、`CovoAudioCode2WavModel`;家族目录 `vllm_omni/model_executor/models/covo_audio/`。
- pipeline key `covo_audio`：stage 0 `fused_thinker_talker`（LLM_AR,多模态入、latent 出,`ignore_eos: True`,stop 151645）→ stage 1 `code2wav`（LLM_GENERATION,音频）。
- 依赖共享模块：[[configuration-architecture]]（Config 组件）、Whisper 风格音频编码（`covo_audio.py`,`MAX_AUDIO_TOKENS=188`,16× 下采样）。

### 结构与 serving

- `token2wav.py`（31 KB）是 DiT 风格 token→wav（TimestepEmbedder/FinalLayer/rotary attention）;`stage_input_processors/covo_audio.py` 提供 `llm2code2wav_full_payload`/`llm2code2wav_token_only` 两种交接。
- **树内带二进制资产**：`speaker_prompt/{prompt_latent,prompt_token,speaker_embed}.npy`（~300 KB 默认说话人 prompt,模型目录里检入 npy 在全仓少见）。
- deploy `covo_audio.yaml` 未 pin checkpoint;stage 1 强制 `dtype: float32`（BigVGAN vocoder fp32 权重）且 `enforce_eager: true`——code2wav 里有 GPU→CPU 同步 `int(code.flatten()[0])`,CUDA-graph capture 非法（YAML 注释）; 标注 1×A100-80G 验证。

### 什么时候查这里

- 审查 covo_audio 的 stage 交接、speaker prompt 资产或 fp32/eager 约束改动; 放宽 stage 1 eager/fp32 前先确认上述两条来源注释仍成立。
- 语义验收（plumbing≠语义）见 [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model-adaptation-guardrails）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/covo-audio/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Covo-Audio（腾讯融合 thinker/talker 语音对话）；type: index；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/model_executor/models/covo_audio/；vllm_omni/deploy/covo_audio.yaml；vllm_omni/config/pipeline_registry.py
