---
name: moss-tts-overview
description: MOSS-TTS 家族目录入口（Delay/Realtime/Local/Nano，一族八份 deploy）：四个架构到 HF 仓的映射、四个 pipeline key 与两 stage 拓扑（talker → delay/raw 处理器 → SharedMemoryConnector → MossTTSCodecDecoder）、request seed 与 adapter 的边界、8 份 deploy yaml 的差异速查、什么时候查
metadata:
  scope: 只收家族名称、架构映射、pipeline key、deploy 速查与目录路由；delay 生命周期、双代 tokenizer 与验证入口归 moss-tts-architecture，codec 选择、reference encoder 与 seed 规则正文归 moss-tts-rules-1、moss-tts-rules-2，注册 voice 归 rules-registered-reference，Local MRv2 归 rules-local-mrv2 与 rules-local-streaming
---
# MOSS-TTS 家族

## 现状

- 以下事实在 `main @ f66f0563` 复核。

### 名称与范围

- OpenMOSS 系 TTS 全家（两个家族目录 `moss_tts` + `moss_tts_nano`）。架构→类→checkpoint 映射：
  - `MossTTSDelayModel` → `MossTTSDelayTalkerForGeneration`,**一个架构服务 4 个 HF 仓**：`OpenMOSS-Team/MOSS-TTS`（8B,n_vq=32）、`OpenMOSS-Team/MOSS-TTSD-v1.0`（对话）、`OpenMOSS-Team/MOSS-SoundEffect`、
    - `OpenMOSS-Team/MOSS-VoiceGenerator`（1.7B）——仓间差异只在 HF config + deploy YAML（`moss_tts_80gb.yaml` 是 MOSS-TTS 的纯 deploy 变体）。
  - `MossTTSRealtime` → `MossTTSRealtimeTalkerForGeneration`（`OpenMOSS-Team/MOSS-TTS-Realtime`,1.7B）。
  - `MossTTSLocalModel` → `MossTTSLocalTalkerForGeneration`（`OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5`）。
  - `MossTTSNanoForCausalLM` → `MossTTSNanoForGeneration`（`OpenMOSS-Team/MOSS-TTS-Nano`,0.1B,独立目录）。
  - stage-1 共用架构 `MossTTSCodecDecoder`（同名类）。
- pipeline key 四个（`moss_tts/pipeline.py` 与 `moss_tts_nano/pipeline.py`, 注册于 `config/pipeline_registry.py`）。两 stage 变体拓扑均为 **LLM_AR talker → delay/raw stage 处理器 → SharedMemoryConnector → `MossTTSCodecDecoder`(LLM_GENERATION)**,区别在 talker 与处理器:
  - `moss_tts_delay`:delay-pattern talker → `talker2codec_delay_async_chunk`, stage 名对 `moss_tts`→`moss_tts_codec`。
  - `moss_tts_realtime`:realtime talker → `talker2codec_raw_async_chunk`, 同 stage 名对。
  - `moss_tts_local`:local talker → raw 处理器,**独立 stage 名对** `moss_tts_local`→`moss_tts_local_codec`（serving 适配按此路由）。
  - `moss_tts_nano`:**单 stage**,AR LM+codec 全在 `forward()` 内以 VoxCPM 式 `inference_stream()` 生成器跑,EOS id 2 由 compute_logits 强制。
- 依赖共享模块：[[configuration-architecture]]（Config 组件）、`utils/speaker_cache`、serving 适配 `entrypoints/openai/tts_adapters/moss_tts.py`。
- shared speech path 在把 `request.seed` 应用到 `SamplingParams` 前调用 adapter `build()`，因此 MOSS adapter 必须自行优先使用显式 request seed（包括 `0`），仅在请求省略时回退 stage-0 默认 seed。这个共享 adapter contract 同时覆盖 full 与 Nano；
  - 端到端效果不是全族可复现性：Nano 消费该字段，Local 早已经由 `tts_local_seed` 和逐请求 generator 接收 request seed，Delay/Realtime 仍缺 request-scoped RNG plumbing。Nano 仍使用 global torch RNG，shipping `max_num_seqs: 4` 下并发异 seed 请求并不隔离。^[PR #6543]

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| registered voice generation、cold resolver 与 prefix salt | [[rules-registered-reference]]（registered reference） | 服务端绑定与音频一致性 |
| delay 生命周期、伪文本 logits、双代 tokenizer | [[moss-tts-architecture]]（architecture） | 数据流与 reviewer 陷阱 |
| codec v1/v2 选择、projection/checkpoint topology | [[moss-tts-rules-1]]（rules；源锚点 #direct-代码快速入口） | loader 门禁与测试缺口 |
| online request `seed`、Nano/Local/Delay/Realtime 的可复现性或并发 | 同页 `MOSSTTS-3a` | adapter precedence 与各变体 RNG 边界 |
| MOSS reference audio 的 cache、并发 encode、TTSD 双 speaker 或 prefix salt | 同页 `MOSSTTS-4a` | content/slot/flight identity、批处理和失败隔离 |

### 配置与 checkpoint 差异（8 份 deploy 速查）

- `moss_tts.yaml`（8B,n_vq=32,24 kHz;**唯一开 codec CUDA graph 的变体**, stage1 `max_model_len 196608`——4096 帧×32 vq 会超 65536）; `moss_tts_80gb.yaml` 仅差 stage0 显存 0.85→0.60 + eager codec + `enable_flashinfer_autotune: false`（单卡 80 GB 装得下,#4643）。
- `moss_ttsd.yaml`（对话 TTS,n_vq=16）;`moss_sound_effect.yaml`（文描音效,无参考音频,~12.5 tok/s）;`moss_voice_generator.yaml`（1.7B 零样本声音设计,**stage0 强制 eager——自定义音频头+每请求 GPU 缓冲不 CUDA-graph 安全,FULL-decode 捕获会崩 worker**）。
- `moss_tts_realtime.yaml`（TTFB ~180 ms,`codec_chunk_frames 15`）; `moss_tts_local.yaml`（**48 kHz 立体声**,v2 tokenizer,首块 80 ms;顶层缺 `trust_remote_code`,与其余双 stage 变体不一致——pin 上未验证是否有意）; `moss_tts_nano.yaml`（L4 验证,无 connectors,`skip_mm_profiling`）。
- 权威 checkpoint→deploy 映射在 `examples/offline_inference/text_to_speech/moss_tts/end2end.py`。

### 什么时候查这里

- 审查任一 MOSS 变体的码流、codec checkpoint 代际、CUDA-graph 开关或 serving 适配;新增变体时先对这 8 份 YAML 的差异矩阵。
- 语义验收见 [[model-validation]]（model-validation）。
- reference attention 平台 keyword/LSE 与短 Unix socket fixture：MOSS-REF-BACKEND-1a/MOSS-REF-TEST-1a；沿本目录 rules 审查入口核对。
- [[rules-local-streaming]]（Local MRv2slot、逐行seed、ramp、first-chunk与sharedreference生命周期）。
- [[rules-local-mrv2]]（MOSS-TTS Local MRv2 profile 与输出合同）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/moss-tts/_index.md`（InferMatrixCopilot@ecfb84d0）；title: MOSS-TTS 家族（Delay/Realtime/Local/Nano,一族八 deploy）；type: index；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-10-06
- 来源（sources）：PR #5635；PR #6664；PR #6543；PR #4982；vllm_omni/model_executor/models/registry.py；vllm_omni/config/pipeline_registry.py；vllm_omni/entrypoints/openai/tts_adapters/moss_tts.py；vllm_omni/entrypoints/openai/serving_speech.py；vllm_omni/model_executor/models/moss_tts/
  - vllm_omni/model_executor/models/moss_tts/reference_encoder.py；vllm_omni/model_executor/models/moss_tts/audio_tokenizer_v2.py；vllm_omni/model_executor/models/moss_tts_nano/；vllm_omni/model_executor/stage_input_processors/moss_tts.py；vllm_omni/deploy/
