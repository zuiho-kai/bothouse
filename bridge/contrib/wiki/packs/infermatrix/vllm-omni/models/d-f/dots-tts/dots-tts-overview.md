---
name: dots-tts-overview
description: "dots.tts（checkpoint dots-studio/dots.tts-soar，约 1.7B 连续 AR TTS，48 kHz 单声道）目录入口：DotsTTSForConditionalGeneration 注册与单 stage key dots_tts、dots_tts.yaml 默认（max_num_seqs 4、enforce_eager、bfloat16、async_chunk false）、/v1/audio/speech 的 DotsTTSAdapter（按 architecture 识别、stage_keys 为空、detect_priority 5、仅 text-only，PR #6235）、共享边界与目录路由"
metadata:
  scope: 只收 dots.tts 的名称、deploy 默认、在线 serving 合同和共享边界；weekly E2E scaffold 规则 DOTS-1a 与 adapter detection 规则 DOTS-2a 归 dots-tts-rules，registry 快照归 models-catalog
---
# dots.tts

## 现状

### 名称与范围

- 知识树 owner：`models/dots-tts`；上游目录 `dots_tts`。
- 正式 checkpoint 为 `dots-studio/dots.tts-soar`；代码、pipeline 和 deploy 标识均为 `dots_tts`。这是约 1.7B 的连续 AR TTS（Qwen2.5-1.5B 基座、DiT 流匹配头和 AudioVAE），输出 48 kHz 单声道音频。^[PR #6235]
- AR registry 入口是 `DotsTTSForConditionalGeneration` → (`dots_tts`, `dots_tts_talker`)，并有单 stage `OMNI_PIPELINES` key `dots_tts`；模型实现位于 `model_executor/models/dots_tts/`。

### 配置与 checkpoint 差异

- 默认 `dots_tts.yaml` 是单 AR stage：`max_num_seqs: 4`、`enforce_eager: true`、`enable_prefix_caching: false`，且默认采样上限为 4096 tokens。
- `async_chunk: false`、全局 `dtype: bfloat16`；该初始集成没有 CUDA Graph 或 batched side-path 优化。

### 在线 serving 合同

- PR #6235 为 `/v1/audio/speech` 注册 `DotsTTSAdapter`。adapter 只按 `DotsTTSForConditionalGeneration` architecture 识别，`stage_keys` 为空且 `detect_priority = 5`：不得因和 VoxCPM2 共用 `latent_generator` stage key 而把请求路由给 VoxCPM2。
- 支持 text-only 合成：`voice` 只能缺省或为 `default`；`ref_audio`、`ref_text`、`speaker_embedding` 和 `x_vector_only_mode` 都不支持。prompt/tokenizer 的首次构建在 TTS executor 异步执行，避免占用 async request handler。
- E2E 覆盖流式 WAV（含 `stream_format="audio"`）和非流式 PCM；二者都通过 `dots_tts.yaml` 启动 L4 单卡 server。^[PR #6235]

### 共享边界

- OpenAI 请求、TTS adapter 注册和流式音频协议属于[[serving-overview]]（Serving 组件）。
- checkpoint talker、prompt builder 和 audio side-path 属于[[model-executor-overview]]（Model Executor 组件）；不要把它们的共享加载或运行时规则复制到本页。

### 什么时候查这里

- 审查 dots.tts 的 checkpoint、单 stage deploy、TTS adapter 检测，或 text-only `/v1/audio/speech` 行为时。
- 共享 OpenAI 协议或其他 TTS 适配器问题先进入 Serving；通用模型加载问题先进入 Model Executor。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| weekly offline E2E scaffold、prompt/queue/noise oracle | [[dots-tts-rules]]（rules） |

### 不放什么

- 上面列出的共享模块的执行、调度、加载或 serving 合同属于 [[components-overview]]（components），这里只链接不复制；registry 快照和别名清单见 [[models-catalog]]（模型 catalog）；一次性历史默认不落盘。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/dots-tts/_index.md`（InferMatrixCopilot@ecfb84d0）；title: dots.tts（单 stage 连续 AR 48 kHz TTS）；type: index；tags: vllm-omni, models, serving；created: 2026-08-13；updated: 2026-09-05
- 来源（sources）：PR #6174；PR #6235；vllm_omni/model_executor/models/dots_tts/；vllm_omni/deploy/dots_tts.yaml；vllm_omni/transformers_utils/configs/dots_tts.py；vllm_omni/entrypoints/openai/tts_adapters/dots_tts.py；tests/e2e/offline_inference/test_dots_tts_expansion.py
  - tests/e2e/online_serving/test_dots_tts_expansion.py
- 置信度（confidence）：high
