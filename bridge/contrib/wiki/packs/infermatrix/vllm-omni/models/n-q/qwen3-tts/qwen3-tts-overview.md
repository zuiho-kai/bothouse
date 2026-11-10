---
name: qwen3-tts-overview
description: "Qwen3-TTS 目录入口（main @ 4ad455e6）：正式 owner（serving、ref audio、artifact cache、async Code2Wav 增量解码、adaptive chunk ramp、NPU patch）、public sample_rate 只接受 24 kHz 或 8 kHz server-resampled（SERV-9b，PR #6553）、serving 与 NPU tokenizer 入口路径、Q3TTS-1d 的 effective task_type 入口提示及各规则页路由"
metadata:
  scope: 只收 Qwen3-TTS 的 owner 范围、入口路径、查阅场景与规则页路由；Q3TTS-1a 至 2a 归 qwen3-tts-rules-1，Q3TTS-3a 至 3e 与性能证据边界归 qwen3-tts-rules-2，Q3TTS-4a 至 5a 与 PR 规则归 qwen3-tts-rules-3，Q3TTS-PROMPT-1a 归 rules-prompt-preprocess，Q3TTS-6a 归 rules-codec-output，模型家族结构归 qwen-omni-overview
---
# Qwen3-TTS

## 现状

- Public `sample_rate` 只接受 adapter 声明的 24 kHz native 或 8 kHz server-resampled output；streaming 状态/header/flush 边界见 [[rules-speech-output]]（SERV-9b；源锚点 #serv-9b-speech-sample_rate-必须由-adapter-capability-限定）。^[PR #6553]

### 名称与范围

- 正式 owner：Qwen3-TTS serving、ref audio、artifact cache、async Code2Wav 增量解码/状态生命周期、adaptive chunk ramp 与模型专有 NPU patch。事实在 `main @ 4ad455e6` 复核。
- serving 入口：`vllm_omni/entrypoints/openai/serving_speech.py`。
- NPU tokenizer patch：`vllm_omni/platforms/npu/models/qwen3_tts_tokenizer_v2.py`；共享 RoPE layout helper 在 `vllm_omni/platforms/npu/layers/rotary_embedding.py`，此 pin 上只证明 Qwen3-TTS consumer。
- 共享请求/cache 合同见 [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（Serving rules）。

### 什么时候查这里

- 审查 `x_vector_only_mode`、ICL、`ref_audio` artifact-only reuse、incremental Code2Wav、segmented CUDA Graph、engine 存活性，或 NPU tokenizer RoPE 的 BNSD/BSND shape fallback。
- 审查 Qwen3-TTS 的 effective `task_type`、uploaded/precomputed stored voice、`tts_model_type`/model-path checkpoint variant 与 Base speaker-embedding mismatch admission 时，直接看 [[qwen3-tts-rules-1]]（Q3TTS-1d；源锚点 #q3tts-1d-effective-task-必须在-dispatch-前与-checkpoint-variant-对齐）；
  - built-in `supported_speakers` 不属于 stored voice。
- 其他源码入口与具体不变量见 Qwen3-TTS rules；模型家族结构见 [[qwen-omni-overview]]（Qwen-Omni）。
- [[rules-prompt-preprocess]]（当前step prompt projection、requestID cache 与speaker embedding）。
- [[rules-codec-output]]（Qwen3-TTS codec tokens 输出合同）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen3-tts/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, serving, qwen-omni；created: 2026-07-20；updated: 2026-09-22
- 来源（sources）：PR #5157；PR #5202；PR #5608；PR #6001；PR #6113；PR #6553；vllm_omni/entrypoints/openai/serving_speech.py；vllm_omni/entrypoints/openai/tts_adapters/qwen3_tts.py；vllm_omni/model_executor/models/qwen3_tts/prompt_embeds_builder.py
  - vllm_omni/model_executor/models/qwen3_tts/qwen3_tts_code2wav.py；vllm_omni/model_executor/models/qwen3_tts/segmented_graph_wrapper.py；vllm_omni/model_executor/stage_input_processors/qwen3_tts.py；vllm_omni/model_executor/stage_input_processors/chunk_size_utils.py
  - vllm_omni/platforms/npu/models/qwen3_tts_tokenizer_v2.py；vllm_omni/platforms/npu/layers/rotary_embedding.py；tests/entrypoints/openai_api/test_serving_speech.py
- 置信度（confidence）：high
