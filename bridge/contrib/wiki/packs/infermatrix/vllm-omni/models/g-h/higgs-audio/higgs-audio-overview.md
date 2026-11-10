---
name: higgs-audio-overview
description: Higgs-Audio 入口：只有 higgs_audio_v2 与 higgs_audio_v3 两个代码谱系（higgs_multimodal_qwen3 即 V3 checkpoint 的 HF 名），AR registry 的 Talker / Code2Wav 键，两个 pipeline key 的两 stage 拓扑，v2 vs v3 的基座、stop token、codec 权重、并发档与互斥的两种 CUDA graph 侧写
metadata:
  scope: 只收 Higgs-Audio 的命名解结、registry 与入口路径、v2 / v3 配置差异一览；delay-pattern 与流式窗口数学归 higgs-audio-architecture，HIGGS-1a…3a 归 higgs-audio-rules，HIGGS-MRV2-* 归 higgs-audio-rules-mrv2-audio
---
# Higgs-Audio

## 现状

- 以下事实在 `main @ c4192568` 复核。

### 名称与范围（先解开命名结）

- **只有两个代码谱系**：`model_executor/models/higgs_audio_v2/` 与 `higgs_audio_v3/`。
  - **`higgs_multimodal_qwen3` 不是第三个谱系**——它是 V3 checkpoint 的 HF 侧名字（config.json architecture `HiggsMultimodalQwen3ForConditionalGeneration`, `AutoConfig.register("higgs_multimodal_qwen3", HiggsAudioV3Config)`,见 `transformers_utils/configs/higgs_audio_v3.py`）,deploy YAML 因此叫
  - `higgs_multimodal_qwen3*.yaml`,全部解析到 v3 代码目录。
- AR registry 映射（**无 diffusion 入口**;每谱系 = 两个 Talker 键 + 一个独立的 Stage-1 Code2Wav 架构,不是三个同类别名）：v2 Talker 键 `HiggsAudioV2ForConditionalGeneration`/`HiggsAudioV2TalkerForConditionalGeneration` → 类 `HiggsAudioV2TalkerForConditionalGeneration`;v2 Code2Wav 键 `HiggsAudioV2Code2WavForConditionalGeneration`
  - → 同名类（`higgs_audio_v2_code2wav`）。v3 Talker 键 `HiggsMultimodalQwen3ForConditionalGeneration`/`HiggsAudioV3TalkerForConditionalGeneration` → 类 `HiggsAudioV3TalkerForConditionalGeneration`;v3 Code2Wav 键 `HiggsAudioV3Code2WavForConditionalGeneration` → 同名类（`higgs_audio_v3_code2wav`）。
- 拓扑定义：`model_executor/models/higgs_audio_v{2,3}/pipeline.py`——两个 pipeline key 都解析到**静态 `PipelineConfig` 对象**（无 resolver）。
- checkpoint（文档/示例记载,YAML 不 pin）：v2 `bosonai/higgs-audio-v2-generation-3B-base`,v3 `bosonai/higgs-audio-v3-tts-4b`。
- pipeline key：`higgs_audio_v2` 与 `higgs_multimodal_qwen3`,拓扑同为两 stage: Talker（LLM_AR,文本→8-codebook codec,latent 出）→ Code2Wav（LLM_GENERATION,codec→24 kHz PCM）,SharedMemoryConnector 相连。
- 职责边界：de-delay 与窗口构建的所有者是两个 stage 处理器 `model_executor/stage_input_processors/higgs_audio_v2.py` 与 `higgs_audio_v3.py`;PCM 重叠修剪归 Code2Wav 的 `forward_chunk`;连接器只供传输与配置。
- 入口路径：registry `vllm_omni/model_executor/models/registry.py` 与 `vllm_omni/config/pipeline_registry.py`;serving 集成
  - `vllm_omni/entrypoints/openai/serving_speech.py`（v3 参考音频 code LRU cache 256 条/64 MiB + in-flight 去重）与 `vllm_omni/entrypoints/openai/protocol/audio.py`（v3 references 映射、v2 富输入别名拒绝）;[[configuration-architecture]]（Config 组件）。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 谱系差异表、delay-pattern 生命周期、流式窗口数学 | [[higgs-audio-architecture]]（architecture） | 数据流与 reviewer 陷阱 |
| V3 request RNG、decode state、voice-clone prompt sentinel 或 chunked prefill substitution | [[higgs-audio-rules]]（rules） | `HIGGS-1a`、`HIGGS-2a`   新增核对：HIGGS-3a。 |

### 配置与 checkpoint 差异（v2 vs v3 一览）

- 基座：v2 = Llama-3.2-3B + DualFFN 音频专家;v3 = Qwen3 ~4B,无 DualFFN, 改用融合 tied `[N*V, D]` 多 codebook 嵌入/头。
- stop token：v2 `[128009, 128012]`;v3 `[151643, 151671]`。
- codec 权重：v2 独立 audio-tokenizer 仓;v3 捆绑在 checkpoint `tied.embedding.modality_embeddings.0.model.*` 下（复用 v2 的 RVQ+DAC 类）。
- v3 deploy 并发档：默认档 stage-0 `max_num_seqs: 16`, `high_throughput` 仅把它抬到 `64`（其余相同）。
- v3 deploy 有**互斥的两种 CUDA graph 侧写**：`enforce_eager: true` 时启用 Higgs 本地 MLP graph（high_throughput 同款,勿再开 vLLM FULL_DECODE）; low_latency 侧写用 `enforce_eager: false` + `FULL_DECODE_ONLY`（本地 graph 自动关闭）。README 另要求 `VLLM_USE_DEEP_GEMM=0` **且** `VLLM_MOE_USE_DEEP_GEMM=0`（除非 DeepGEMM 支持被重新验证）。
- v3 stage 0 开 prefix caching（v2 关）。

### 什么时候查这里

- 审查任一 Higgs 谱系的 delay pattern、流式分块或 graph 侧写改动;两谱系共享 codec 常量（8×1026,25 fps × hop 960;v2 称 BOS/EOS 1024/1025,v3 称 BOC/EOC 1024/1025）。
- 语义验收见 [[model-validation]]（model-validation）。
- [[higgs-audio-rules-mrv2-audio]]（V3 MRv2 state、sampling 与 audio snapshots）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/higgs-audio/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Higgs-Audio（V2/V3 双谱系 TTS;higgs_multimodal_qwen3 即 V3）；type: index；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-10-06
- 来源（sources）：PR #6422；PR #7065；vllm_omni/entrypoints/openai/serving_speech.py；vllm_omni/model_executor/models/higgs_audio_v2/；vllm_omni/model_executor/models/higgs_audio_v3/；vllm_omni/model_executor/models/higgs_audio_v3/higgs_audio_v3_tokenizer.py
  - vllm_omni/model_executor/models/higgs_audio_v3/higgs_audio_v3_talker.py；vllm_omni/transformers_utils/configs/higgs_audio_v3.py；tests/entrypoints/openai_api/test_serving_speech.py；tests/model_executor/models/higgs_audio_v3/test_higgs_audio_v3.py
  - tests/e2e/online_serving/test_higgs_audio_v3.py
