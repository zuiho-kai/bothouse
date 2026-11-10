---
name: fish-qwen3-omni-overview
description: Fish Speech S2 Pro（fish_qwen3_omni）入口：model_type / 源码目录 fish_speech / checkpoint fishaudio/s2-pro 三层命名，Slow AR + DAC decoder 两个 stage（Fast AR 不注册），fish_kvcache 注意力内核，四份 deploy YAML 的并发 / 轮询 / DAC 放卡差异与 enable_chunked_prefill false 硬约束
metadata:
  scope: 只收 fish_qwen3_omni 的命名、registry / pipeline 入口、四份 deploy YAML 差异和查阅指引；双 AR 数据流与背压流式归 fish-qwen3-omni-architecture，FISH-STREAM-1a 归 fish-qwen3-omni-rules
---
# Fish Speech S2 Pro（fish_qwen3_omni）

## 现状

- 以下事实在 `main @ 5d44868e` 复核。

### 名称与范围

- 命名三层：HF `model_type` = `fish_qwen3_omni`（registry key/deploy 文件名随它）;源码目录 `fish_speech`;checkpoint `fishaudio/s2-pro`。AutoConfig 注册 shim（`transformers_utils/configs/fish_speech.py`）绑三个 model_type 串——**漂移会在 vLLM 启动前就断加载**。
- 模型 registry：`FishSpeechSlowARForConditionalGeneration` + `FishSpeechDACDecoder`;**Fast AR 不注册**——嵌在 Slow AR 内（`talker_mtp`,私有非分页 KV）。
- pipeline key `fish_qwen3_omni`：stage 0 `fish_speech_slow_ar`（LLM_AR, 文本→RVQ latent 码）→ stage 1 `dac_decoder`（LLM_GENERATION,latent 码经 async-chunk 流到最终音频）。**stage 分界是 AR vs DAC 声码器,不是 slow-vs-fast AR**;只有 async-chunk 路径,无 sync 处理器。
- 入口路径：模型 registry `vllm_omni/model_executor/models/registry.py`; 拓扑 `vllm_omni/model_executor/models/fish_speech/pipeline.py`（注册于 `vllm_omni/config/pipeline_registry.py`）;
  - 桥 `vllm_omni/model_executor/stage_input_processors/fish_speech.py`;serving 适配 `vllm_omni/entrypoints/openai/tts_adapters/fish_speech.py`。
- 依赖共享模块：`utils/speaker_cache`（克隆参考音频 DAC 编码进程内完成）、[[configuration-architecture]]（Config 组件）;**全家族唯一自带 attention 内核的**:`vllm_omni/attention/fish_kvcache_*`（Triton, `VLLM_OMNI_FISH_KVCACHE_ATTN` 默认开,1024 token 长短路径分割）。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 双 AR 结构、背压自适应流式、部署矩阵 | [[fish-qwen3-omni-architecture]]（architecture） | 数据流与 reviewer 陷阱 |

### 配置与 checkpoint 差异（4 份 deploy）

- 共同硬约束：`enable_chunked_prefill: false`（SlowAR 解码环不 chunked-prefill 安全）→ 被迫 `max_num_batched_tokens == max_model_len == 16384`。
- 四份 YAML 跑**同一模型/同一 pipeline**,只是部署参数不同。`fish_qwen3_omni.yaml`（1×H20 验证,4/1 并发,轮询 **10 ms**;唯一带 XPU override）;
  - 其余三份都用 **1 ms** 轮询:`_2gpu.yaml`（H100×2,DAC 上卡 1, **64/64 并发**）;`high_concurrency_single_gpu.yaml`（64/64 并发, **DAC 仍在卡 0**）与 `high_concurrency_dual_gpu.yaml`（同 knob 组,**DAC 移到卡 1** 消除 AR/DAC 干扰）——两份 high-concurrency 共享专属 knob 组: `fish_speech_tensor_codes`、`fish_speech_single_initial_chunk`、
  - backlog 自适应 50 帧@0.75 负载、fp16 DAC（`fish_speech_dac_dtype`）、`fish_speech_dac_max_padded_frames`、`fish_speech_dac_max_batch`。
- **pin 上没有 fish 的 e2e 测试**（只有 SIP 与 attention 单测）——改动本家族的行为验证要靠示例/手工,评审时把"绿测"当弱信号。

### 什么时候查这里

- 审查 fish 的 KV 注意力、背压流式或 chunked-prefill 约束改动;上调并发前先读 high_concurrency YAML 的 knob 语义。
- 语义验收见 [[model-validation]]（model-validation）。
- [[fish-qwen3-omni-rules]]（Fish Speech streaming 规则） — 自适应 chunk 的绝对帧 frontier 与 terminal。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/fish-qwen3-omni/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Fish Speech S2 Pro（fish_qwen3_omni,双 AR 单 stage）；type: index；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-10-06
- 来源（sources）：vllm_omni/model_executor/models/fish_speech/；vllm_omni/attention/fish_kvcache_attn.py；vllm_omni/deploy/fish_qwen3_omni.yaml
