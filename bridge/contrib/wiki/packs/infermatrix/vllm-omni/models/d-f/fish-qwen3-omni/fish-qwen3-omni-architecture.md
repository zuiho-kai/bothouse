---
name: fish-qwen3-omni-architecture
description: Fish Speech S2 Pro 架构：Slow AR（Qwen3Model backbone）内嵌不注册的 4 层 Fast AR、DAC decoder / encoder、fish_kvcache 注意力；三个 AutoConfig model_type、codec 参数（约 21 Hz、25 帧块）、slow_ar_to_dac_decoder_async_chunk 背压自适应 25→50 帧、单测与未决项
metadata:
  scope: 只收 Fish Speech 的模块边界、checkpoint / codec 合同、输入到输出流程和验证现状；命名与四份 deploy YAML 速览归 fish-qwen3-omni-overview，streaming 规则归 fish-qwen3-omni-rules
---
# Fish Speech S2 Pro 架构

## 现状

- 事实在 `main @ 5d44868e` 复核;命名/部署速览见 [[fish-qwen3-omni-overview]]（index）。

### 模型专有部分与共享模块的边界

- Slow AR（注册,vLLM `Qwen3Model` backbone）：多 codebook 输入嵌入（语义 token 位置 = 文本 + codebook 嵌入求和）、语义 logit 掩码;树内 docstring 自述"类比 qwen3_tts 的 Talker"。
- Fast AR（**不注册**,`fish_speech_fast_ar.py`）：4 层 transformer,在每个 Slow-AR 步内自回归补齐残差 codebook（1..n−1）;自有嵌入/RoPE/头 + 每调用微型 KV cache,`_FastAR*` 层**显式绕开 vLLM 分页注意力**;预分配缓冲/内联采样等优化在 docstring 记录。
- DAC 侧：`fish_speech_dac_decoder.py`（读 connector `extra` 配置,含 `fish_speech_dac_dtype: fp16` knob）;`dac_encoder.py` 做参考音频编码（克隆路径,speaker cache 缓存）。
- 家族专属注意力：`attention/fish_kvcache_{attn,backend,triton}.py`—— 默认启用（`VLLM_OMNI_FISH_KVCACHE_ATTN`,支持 `required` 模式）, 长序列 1024 分割,线程锁 workspace 缓存。

### 配置、checkpoint 和兼容范围

- checkpoint 合同：`fishaudio/s2-pro`（示例 DEFAULT_MODEL 与 2gpu YAML 用法注释;YAML 本体不 pin）;语义验收方法见 [[model-validation]]（model-validation）。
- 三个 AutoConfig model_type 必须保持注册：`fish_qwen3_omni`（Omni 捆绑 config）、`fish_qwen3`（Slow AR）、`fish_qwen3_audio_decoder`（Fast AR）。
- codec 参数：~21 Hz,`codec_chunk_frames 25`（≈1.16 s）+ 左上下文 25, 首块 4 帧;stop token `[151645]`。

### 从输入到输出的主要流程

1. prompt 经 `prompt_utils.py` 构建（文本-only 或克隆:参考音频 DAC 编码 + 控制 token）。
2. Slow AR 每调度步出 1 个语义 token → 嵌套 Fast AR 立刻补齐该帧其余 codebook——**一帧完整 RVQ 码在单次 forward 内产完**。
3. `slow_ar_to_dac_decoder_async_chunk`（唯一注册的 SIP）流式发块;
   - **背压自适应**：codec stage 负载超 `fish_speech_backlog_load_threshold`（0.75）时块从 25 帧翻到 50 帧（`_select_backlog_chunk_size`,仅 high-concurrency YAML 激活）;`fish_speech_tensor_codes` 切张量载荷。
4. DAC decoder 出波形。

### 怎样验证功能、精度和性能

- 单测：`tests/attention/test_fish_kvcache_attn.py`、`tests/model_executor/stage_input_processors/test_fish_speech_async_chunk.py`; **无 e2e expansion 测试**（pin 上）——示例提供功能/手工验证（`examples/offline_inference/text_to_speech/fish_speech/end2end.py` 与 serving 示例）,
  - 基准 `benchmarks/fish-speech/bench_speaker_cache.py` **只覆盖 speaker cache**;pin 上无专门的精度或全链路性能测试。recipe `recipes/fishaudio/Fish-Speech-S2-Pro.md`。
- 已知未决：`fish_speech_dac_max_batch: 0` 的语义（无限 vs 关闭）未追; `fish_speech_single_initial_chunk` 与 `initial_codec_chunk_frames: 4` 的首发优先级未追;fish_kvcache 后端覆盖 backbone 全部注意力还是仅长 prompt 路径未读 dispatch。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/fish-qwen3-omni/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/model_executor/models/fish_speech/fish_speech_slow_ar.py；vllm_omni/model_executor/models/fish_speech/fish_speech_fast_ar.py；vllm_omni/model_executor/stage_input_processors/fish_speech.py
