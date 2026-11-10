---
name: indextts2-overview
description: "IndexTTS2（IndexTeam/IndexTTS-2，非流式两 stage，GPT talker + S2Mel/BigVGAN）目录入口：pipeline key indextts2、registry 两入口（talker 为 LLM_AR，S2Mel decoder 为 LLM_GENERATION）、入口路径、indextts2_low_latency.yaml 的 CUDA graph 与 FLASHINFER 变体差异、哑 tokenizer、repetition_penalty: 10.0 为官方行为"
metadata:
  scope: 只收名称范围、registry 与拓扑、配置差异、何时查和指向 request-end 规则的链接；全载荷合同、tokenizer 旁路与 hf_overrides 开关归 indextts2-architecture，request-end latent 规则归 indextts2-rules，2.5 版入口归 indextts-2-5-overview
---
# IndexTTS2

## 现状

- 以下事实在 `main @ 5d44868e` 复核。

### 名称与范围

- 正式名称 IndexTTS-2（checkpoint `IndexTeam/IndexTTS-2`,YAML 头注/示例记载）;代码/家族别名 IndexTTS2;pipeline key `indextts2`。
- 模型 registry 两入口（**无 diffusion registry 入口**——S2Mel 的 DiT/流匹配是家族内代码;注意第二个入口是 LLM_GENERATION stage,不是 AR）：`IndexTTS2TalkerForConditionalGeneration` →（`indextts2`, `indextts2_talker`）;`IndexTTS2S2MelDecoder` →（`indextts2`, `indextts2_s2mel_decoder`）。
- 入口路径：registry `vllm_omni/model_executor/models/registry.py` 与 `vllm_omni/config/pipeline_registry.py`;拓扑 `vllm_omni/model_executor/models/indextts2/pipeline.py`;
  - 桥 `vllm_omni/model_executor/stage_input_processors/indextts2.py`;serving 适配 `vllm_omni/entrypoints/openai/tts_adapters/indextts2.py`;deploy `vllm_omni/deploy/indextts2{,_low_latency}.yaml`。
- pipeline key `indextts2`：talker（LLM_AR,GPT-2 系,文本→mel 码,latent 出, stop `[8193]`）→ S2Mel decoder（LLM_GENERATION,flow matching→mel→BigVGAN →音频）。两 stage 非流式拓扑：无 async_chunk 处理器,S2Mel 要整段 mel 码序列,connector 每请求一个全载荷。
- 依赖共享模块：vLLM 原生 GPT-2 块/PagedAttention（talker 基座）、SharedMemoryConnector、diffusion hub 预取锁（BigVGAN 懒加载守卫）、`utils/speaker_cache`、[[configuration-architecture]]（Config 组件）。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 全载荷合同、脱离引擎的 tokenizer、hf_overrides 开关板 | [[indextts2-architecture]]（architecture） | 数据流与 reviewer 陷阱 |

### 配置与 checkpoint 差异

- 一个 pipeline key;`indextts2_low_latency.yaml` 是纯 deploy 变体,差异全在 stage 0：FULL_DECODE_ONLY CUDA graph（capture sizes `[1,2,4,8,16]`, 1 warmup）+ FLASHINFER + `async_scheduling: false`,批量包络 `max_num_seqs` 4→16、gpu_mem 0.4→0.6、batched tokens 512→4096;stage 1 与 connector 两份 YAML 逐字节一致。
- 两 stage 都 `skip_tokenizer_init: true` + `tokenizer: gpt2`（哑 tokenizer; 真实分词在家族内 `IndexTTS2Tokenizer`/adapter 完成）。
- stage-0 采样带 **`repetition_penalty: 10.0`**——官方 IndexTTS2 行为的一部分,不是待修的"离谱默认值"。

### 什么时候查这里

- 审查 indextts2 的全载荷合同、tokenizer 旁路或 stage-1 hf_overrides 性能开关;想给它加流式先看 architecture 里的非流式根因。
- 语义验收见 [[model-validation]]（model-validation）。
- [[indextts2-rules]]（request-endlatent、generichidden与整段S2Mel交付）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/indextts2/_index.md`（InferMatrixCopilot@ecfb84d0）；title: IndexTTS2（非流式两 stage,GPT talker + S2Mel/BigVGAN）；type: index；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-10-06
- 来源（sources）：vllm_omni/model_executor/models/indextts2/；vllm_omni/deploy/indextts2.yaml；vllm_omni/model_executor/stage_input_processors/indextts2.py
