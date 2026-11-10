---
name: indextts-2-5-overview
description: "IndexTTS 2.5 目录入口（PR #5957）：registry / pipeline key indextts2_5、IndexTTS25TalkerForConditionalGeneration 与 IndexTTS25S2MelDecoder、两 stage 同卡 non-streaming（code-only use_gpt_latent=false，22.05 kHz mono，async chunk 不适用）、能力范围与按主题的路由"
metadata:
  scope: 只收 2.5 的键名、拓扑摘要、能力范围与路由；精确拓扑与 conditioning 归 indextts-2-5-architecture，请求、bundle、payload 与证据边界规则归 indextts-2-5-rules，2.0 版入口归 indextts2-overview
---
# IndexTTS 2.5

## 现状

- registry/pipeline key：`indextts2_5`；architecture 为 `IndexTTS25TalkerForConditionalGeneration` 与 `IndexTTS25S2MelDecoder`，复用 versioned IndexTTS2 implementations。
- 两 stage、同卡、non-streaming pipeline：AR talker 生成完整 semantic codes，S2Mel CFM/DiT + EnhancedCodec + BigVGAN 输出 22.05 kHz mono audio。标准 deploy 使用 code-only `use_gpt_latent=false`，Stage 1 必须等 request-end full payload；async chunk 不适用。
- 支持 reference/uploaded named voice、emotion controls、multilingual frontend 与 native speed；精确拓扑与 versioned conditioning 见 [[indextts-2-5-architecture]]（architecture），请求、bundle、payload、性能和验证边界见 [[indextts-2-5-rules]]（rules）。

### 路由

- IndexTTS 2.5 模型、codec、S2Mel、tokenizer、recipe：本 owner。
- shared TTS HTTP/streaming adapter：[[serving-overview]]（Serving）。
- request-end payload snapshot 与 runner：[[model-executor-overview]]（Model Executor）。
- full-payload admission：[[scheduler-overview]]（Scheduler）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/indextts-2-5/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models；created: 2026-09-02；updated: 2026-09-02
- 来源（sources）：PR #5957；vllm_omni/config/pipeline_registry.py；vllm_omni/deploy/indextts2_5.yaml；vllm_omni/model_executor/models/registry.py；vllm_omni/model_executor/models/indextts2/；vllm_omni/model_executor/stage_input_processors/indextts2.py
  - vllm_omni/entrypoints/openai/tts_adapters/indextts2.py；recipes/IndexTeam/IndexTTS-2_5.md
- 置信度（confidence）：high
