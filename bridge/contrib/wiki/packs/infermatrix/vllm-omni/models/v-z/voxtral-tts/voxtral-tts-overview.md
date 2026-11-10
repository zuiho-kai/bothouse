---
name: voxtral-tts-overview
description: Voxtral TTS（Mistral 两 stage 流式 TTS，main @ 53afbf3a）目录入口：三个 AR registry 类是 stage 组件而非变体、pipeline key voxtral_tts 的 audio_generation → audio_tokenizer、acoustic transformer 的 CUDA graph wrapper、async_chunk 的 codec_chunk_frames 25、两 stage 的 mistral 加载三件套必须一致、cfg_alpha 1.2、XPU override 合并进同一 deploy YAML
metadata:
  scope: 只收 Voxtral TTS 的名称、registry、pipeline、deploy 要点与查阅场景；hot-path graph、host sync 与 CFG metadata 规则 VOXTTS-1a 至 1c 归 voxtral-tts-rules
---
# Voxtral TTS

## 现状

- 以下事实在 `main @ 53afbf3a` 复核。

### 名称与范围

- 正式名称 Voxtral TTS（Mistral;无别名、**无变体**——注册的三个类是 stage 组件而非模型变体）。AR registry：`VoxtralTTSForConditionalGeneration`、`VoxtralTTSAudioGeneration`、`VoxtralTTSAudioTokenizer` → 家族目录 `vllm_omni/model_executor/models/voxtral_tts/`（6 个文件）。
- pipeline key `voxtral_tts`：stage 0 `audio_generation`（LLM_AR,tokenizer owner,latent）→ stage 1 `audio_tokenizer`（LLM_GENERATION,音频; `tts_args.max_instructions_length: 500`）。
- 依赖共享模块：[[configuration-architecture]]（Config 组件）。

### 结构与 serving

- `cuda_graph_acoustic_transformer_wrapper.py`：把 semantic-logit + n 步 Euler ODE（含 CFG）按固定 batch size 捕获进 CUDA graph（docstring 注明仅 FlowMatching）;`voxtral_tts_audio_generation.py` 可选 apex `FusedRMSNorm`。
- stage 交接：`stage_input_processors/voxtral_tts.py` `generator2tokenizer_async_chunk`。
- deploy `voxtral_tts.yaml` 未 pin checkpoint;`async_chunk: true` SharedMemoryConnector（`codec_chunk_frames: 25`,起始 5）;**两 stage 的 `tokenizer_mode/config_format/load_format` 都是 `mistral` 且必须一致**（YAML 注释）;stage 0 采样 `extra_args.cfg_alpha: 1.2`;标注 1×H20 验证。
- XPU override 已从独立 stage config 合并到 `vllm_omni/deploy/voxtral_tts.yaml` 的 `platforms.xpu.stages`，不再维护第二份拓扑。

### 什么时候查这里

- 审查 voxtral_tts 的 mistral 加载三件套一致性、acoustic CUDA-graph 或 async-chunk 改动；XPU 路径回归检查同一 deploy YAML 的 platform override。
- hot-path graph/sync/cache 边界见 [[voxtral-tts-rules]]（Voxtral-TTS rules）。
- 语义验收见 [[model-validation]]（model-validation）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/voxtral-tts/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Voxtral TTS（Mistral 两 stage 流式 TTS）；type: index；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-09-02
- 来源（sources）：PR #5175；vllm_omni/model_executor/models/voxtral_tts/；vllm_omni/deploy/voxtral_tts.yaml
