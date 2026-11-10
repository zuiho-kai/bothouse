---
name: indextts-2-5-architecture
description: IndexTTS 2.5 架构：Talker（tokenizer-free LLM_AR，Triton attention）与 S2Mel decoder（LLM_GENERATION，request end 一次接收完整 payload，EnhancedCodec + CFM/DiT + BigVGAN）两 stage 数据流、2.0 与 2.5 conditioning 对照表、code-only 与 GPT latent 路径、官方 bundle 缺 config.json 的合成与 60,509 大小的 tiktoken tokenizer ABI
metadata:
  scope: 只收两 stage 数据流、2.0 与 2.5 conditioning 分界和 bundle / tokenizer ABI；请求语义、placeholder 精确相等、asset fail-closed 与 dynamic batching 门禁归 indextts-2-5-rules，入口摘要归 indextts-2-5-overview
---
# IndexTTS 2.5 架构

## 现状

### 两 stage 数据流

1. `IndexTTS25TalkerForConditionalGeneration` 是 tokenizer-free `LLM_AR` stage。serving 用与 Talker 相同的 frontend 估算 dummy token span，runner 在该 span 上注入 speaker、language、W2V-BERT reference 和 text embeddings。非 RoPE GPT-2 路径使用 Triton attention；标准 sampling 是 plain vLLM `num_beams=1` 语义。
2. `IndexTTS25S2MelDecoder` 是 tokenizer-free `LLM_GENERATION` stage。它在 request end 一次接收完整 semantic-code/conditioning payload，经 EnhancedCodec、length regulator、CFM/DiT 和 BigVGAN 生成 22.05 kHz mono waveform。connector 因此是 `codec_streaming=false`，pipeline 不允许 async chunk。
- 标准 deploy 的两个 stage 都在 device 0，但这只是默认 placement，不是跨设备能力结论。

### 2.0 与 2.5 conditioning 分界

| 语义 | IndexTTS 2.0 | IndexTTS 2.5 |
|---|---|---|
| prefill prefix | 34 tokens；Conformer/Perceiver | 3 tokens；projected CAMPPlus speaker + 2 zero rows |
| reference semantic | RepCodec | W2V-BERT sequence |
| language | text frontend | text token + language embedding |
| Stage-1 codec | RepCodec 路径 | EnhancedCodec |
| GPT latent | 默认开 | 官方默认关；实验性 opt-in |

- 2.5 的 code-only 路径不在每个 decode step 携带重复 GPU code row；完成时从 request-owned `output_token_ids` 构造 mel codes，full payload 只携带 conditioning metadata。若显式启用 GPT latent，code 与 latent 必须同时存在且长度精确一致。

### Bundle 与 tokenizer ABI

- 官方 2.5 local bundle 可以没有 HF `config.json`；仅在 model type 可确认为 `indextts2_5` 且确实缺文件时合成 versioned config。顶层 `vocab_size` 供 vLLM warmup，nested GPT defaults 再与显式 override 合并。
- tokenizer 文件是 `multilingual_zh_ja_yue_char_del.tiktoken`；58,836 个 mergeable ranks 加 1,673 个 special tokens 构成 60,509 大小的 ABI，加载时精确校验。
- language-token/embedding 行顺序是 checkpoint ABI，不等于官方质量声明。`zhen` 使用字面 prefix，但 embedding row 归一到 `common`；服务对外文档化的语言是 zh/en/ja/es/ar。
- 请求语义、精确 placeholder、本地 asset fail-closed 和 dynamic batching 门禁见 [[indextts-2-5-rules]]（rules）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/indextts-2-5/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models；created: 2026-09-02；updated: 2026-09-02
- 来源（sources）：PR #5957；vllm_omni/config/pipeline_registry.py；vllm_omni/deploy/indextts2_5.yaml；vllm_omni/model_executor/models/indextts2/configuration_indextts2.py；vllm_omni/model_executor/models/indextts2/indextts2_talker.py；vllm_omni/model_executor/models/indextts2/indextts2_s2mel_decoder.py
  - vllm_omni/model_executor/models/indextts2/tokenizer_v2_5.py；vllm_omni/model_executor/stage_input_processors/indextts2.py
- 置信度（confidence）：high
