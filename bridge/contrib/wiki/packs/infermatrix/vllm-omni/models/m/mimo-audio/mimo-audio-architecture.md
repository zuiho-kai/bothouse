---
name: mimo-audio-architecture
description: "MiMo-Audio 架构：stage 0 融合 thinker+talker 与 CUDA-graph 化 local transformer、stage 1 Code2Wav（VQ 反量化、AudioDecoder、Vocos）、8 通道 x 4 group 码组几何、5+5 交错、async_chunk 与 sync 两条交接路径、codec_left_context_frames 稳定性下限 40、功能面验证入口（PR #6803）"
metadata:
  scope: 只收 MiMo-Audio 的模型结构、数据流与验证入口；名称、registry 与 deploy 配置差异归 mimo-audio-overview
---
# MiMo-Audio 架构

## 现状

- 事实在 `main @ 5d44868e` 复核;入口/命名速览见 [[mimo-audio-overview]]（index）。

### 模型专有部分与共享模块的边界

- 专有 stage 0（`mimo_audio_llm.py`）：**融合 thinker+talker**——理解、文本、RVQ 码生成都在一个 AR stage（对照 [[qwen-omni-overview]]（qwen-omni） 的 thinker/talker 分离);Qwen2 backbone + CUDA-graph 化的 local transformer（`MiMoLocalDecodeCudaGraph` 等,逐步产 RVQ 码）;自有采样器 `MiMoSampler`/`MiMoLocalSamplerTensor`。
- vLLM 0.28 只在 `SupportsPP` protocol 标注 callable，不会在 runtime 提供它；因此 stage-0 wrapper 在 nested Qwen2 构造后委托 `make_empty_intermediate_tensors`。这不是 Token2Wav、Covo 或 PP>1 的实现/验证声明。^[PR #6803]
- 专有 stage 1（`mimo_audio_code2wav.py` + vendored `modeling_audio_tokenizer.py`/`quantization.py`）：VQ 反量化 → AudioDecoder → Vocos 声码器;`CUDAGraphMiMoDecoderWrapper` 把**整条解码路径**按 (RVQ 深度, bucket) 捕获成 CUDA graph,非因果滑窗注意力掩码是静态张量、重放前原地更新;tokenizer worker 按归一化 realpath 键进程级缓存（同一进程内同键不重复加载多 GB tokenizer）。
- 共享：vLLM qwen2_audio 处理栈;worker-connector 全载荷面。

### 配置、checkpoint 和兼容范围

- checkpoint 合同：LLM `XiaomiMiMo/MiMo-Audio-7B-Instruct`（示例默认）; audio tokenizer **必须独立提供**（`XiaomiMiMo/MiMo-Audio-Tokenizer`,经 `model_config.audio_tokenizer_path` 或 env,缺失 raise）;ASR `XiaomiMiMo/MiMo-V2.5-ASR` 共享同一 pipeline/类,serving 边界未决。
- 码组几何：每 AR 步出 `(8 通道 × 4 group)` 码块;wire 格式 = 加 pad 行后列主序展平;各 codebook 词表异构（`"1025-1025-129-129-129-129-129-129"`,各自有 zero-emb 下标）;delay pattern `0-1-2-3-4-5-6-7`。
- 关键常量（`config_mimo_audio.py`）：span 标记 151670/151672; `NO_INTERLEAVE_NEXT_TOKEN_ID=151671` 兼任 stage-0 stop token 与音频边界; `TEXT_GROUP_SIZE=5`。
- `model_stage` 环境变量优先于 `vllm_config.model_config.model_stage`（包装类 `__init__`）——调试/测试时注意环境泄漏。
- 模态边界：pin 上**只支持音频**——image/video 占位符字符串虽已声明,代码注释明示仅 audio 模态生效。

### 从输入到输出的主要流程

1. prefill 前处理 `interleave_5_and_5_in_span`：prompt id 按 5 文本+5 音频交错重组;音频占位 `<|sosp|><|empty|><|eosp|>`。
2. stage 0 逐步出 `(B,1,8,4)` 码块;文本经正常 detokenize 同时交付—— **stage 0 文本与 stage 1 音频是两个独立 final output**;stage-0 停止条件是 `NO_INTERLEAVE_NEXT_TOKEN_ID=151671` 与 `151645`（`<|im_end|>`）两个 stop id。
3. 交接双路径（`stage_input_processors/mimo_audio.py`）：async_chunk 逐步累积、按 `codec_chunk_frames` 冲刷（**完成时 `_flush_remaining_codes` 冲最后不满块——漏掉会截尾音频**）;sync 路径 `llm2code2wav_token_only` 只发零占位 prompt（让消费端分配槽位）,真码走 `llm2code2wav_full_payload` 的 worker-connector 面（全零码行被过滤）。
4. **稳定性下限（音质 bug 类别）**：`codec_left_context_frames ≥ 40`——左上下文必须盖住 vocoder 注意力窗口（默认 `[40,10]`）,低于下限会被强制改写并告警;违反表现为 chunk 边界处声学状态重置/音色漂移。`MAX_CODE2WAV_TOKENS=18192` 硬顶,超限在 full_payload 中静默截断。
5. stage 1 Code2Wav：加 pad 行后按列主序展平的码流 → RVQ 反量化 → AudioDecoder → Vocos 声码器 → 波形（`CUDAGraphMiMoDecoderWrapper` 把整条路径按 (深度, bucket) 捕获成 CUDA graph）。

### 怎样验证功能、精度和性能

- pin 上只有**功能面**验证入口;无精度基线或性能 gate 证据,下列测试不覆盖精度/性能维度,相关结论需另行实测。
- 单元：`tests/model_executor/models/mimo_audio/`（batch decode、per-request 码隔离）、`tests/model_executor/stage_input_processors/`（`test_mimo_audio_flush_remaining_codes.py`、`test_mimo_audio_llm2code2wav.py`）。
- e2e：`tests/e2e/online_serving/test_mimo_audio_expansion.py`;离线示例 `examples/offline_inference/mimo_audio/end2end.py`（tts_sft/理解/对话/多轮多题型）。
- 已知未决：MiMo-V2.5-ASR checkpoint 是否设计为 thinker-only 服务不可从 pin 判定;stop token 151645 与 151671 的实际先后是运行期行为。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/mimo-audio/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-09-05
- 来源（sources）：PR #6803；vllm_omni/model_executor/models/mimo_audio/mimo_audio.py；vllm_omni/model_executor/models/mimo_audio/mimo_audio_llm.py；vllm_omni/model_executor/models/mimo_audio/mimo_audio_code2wav.py；vllm_omni/model_executor/models/mimo_audio/cuda_graph_decoder_wrapper.py
  - vllm_omni/model_executor/models/mimo_audio/modeling_audio_tokenizer.py；vllm_omni/model_executor/models/mimo_audio/quantization.py；vllm_omni/model_executor/models/mimo_audio/pipeline.py；vllm_omni/model_executor/stage_input_processors/mimo_audio.py
  - vllm_omni/model_executor/models/mimo_audio/config_mimo_audio.py
