---
name: step-audio2-overview
description: "Step-Audio2（main @ bfe8967c）目录入口：三变体共用 stepfun-ai/Step-Audio-2-mini 与同一份 thinker 代码、AR registry 五入口到三个类、pipeline key step_audio_2 与仅 thinker 的 step_audio_2_asr（只能靠 deploy YAML 显式选择）、入口路径与三份 deploy YAML 差异、HiFT/mel 改用树内 CosyVoice3 实现（PR #5869）、flashcosyvoice 依赖"
metadata:
  scope: 只收 Step-Audio2 的名称、registry、pipeline key、入口路径、三变体配置差异与规则页路由；token 过滤桥与流式状态归 step-audio2-architecture，STEPA2-1a 至 2b 归 step-audio2-rules
---
# Step-Audio2

## 现状

- 以下事实在 `main @ bfe8967c` 复核。

### 名称与范围

- 家族/checkpoint 名 Step-Audio 2（文档/示例 checkpoint `stepfun-ai/Step-Audio-2-mini`,YAML 不 pin;token 配置声明跨 mini/7B 不变）。**三个变体共用这一个 checkpoint 与同一份 thinker 代码——变体由 pipeline 对象 + deploy YAML 决定,不是模型代码分支。**
- AR registry 五入口 → 三个类:包装 `StepAudio2ForConditionalGeneration`（`StepAudio2ForCausalLM` 是它的 registry 架构别名,不是另一个 Python 类）、thinker `StepAudio2ThinkerForConditionalGeneration`、token2wav `StepAudio2Token2WavForConditionalGeneration`;**无 diffusion 入口**。
- pipeline key 两个:`step_audio_2`——stage 0 thinker（LLM_AR,latent 引擎输出,final 文本,架构键 `StepAudio2ThinkerForConditionalGeneration`）→ stage 1 token2wav（LLM_GENERATION,消费 stage 0,final 音频,架构键 `StepAudio2Token2WavModel`）;`step_audio_2_asr`——仅 thinker,`text` 引擎输出,**无 `hf_architectures`,不能被自动探测,
  - 只能靠 deploy YAML `pipeline:` 键显式选择**。
- 入口路径:拓扑 `vllm_omni/model_executor/models/step_audio2/pipeline.py`（注册于 `vllm_omni/config/pipeline_registry.py`）;实现 `vllm_omni/model_executor/models/step_audio2/`（`step_audio2.py` 包装、`step_audio2_thinker.py`、`step_audio2_token2wav.py`、`step_audio2_constants.py`）;
  - 桥 `vllm_omni/model_executor/stage_input_processors/step_audio2.py`;deploy `vllm_omni/deploy/step_audio_2{,_async_chunk,_asr}.yaml`。
- 依赖共享模块：[[configuration-architecture]]（Config 组件）; 家族专属 reasoning parser（`vllm_omni/reasoning/step_audio_reasoning_parser.py`）; serving 双入口——chat completions **和** `/v1/audio/speech`（`serving_speech.py`）。
- 独有外部运行时依赖仍包括 `onnxruntime`、`s3tokenizer`、`hyperpyyaml`；project 依赖的 `step-audio2` package 仍携带/标注 `flashcosyvoice`，但目标 runtime 已不再从它 import HiFT/mel。
- HiFT 与 mel spectrogram 已改用树内 CosyVoice3 实现；strict state-dict 与数值测试对 `flashcosyvoice` reference 校验架构/输出，但测试在缺 optional package 时整体 skip，且 MiniCPM-o 的 `HiFTGraphWrapper` 没有接入 Step-Audio2。^[PR #5869]

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| token 过滤桥、25+3 lookahead、流式状态 | [[step-audio2-architecture]]（architecture） | 数据流与 reviewer 陷阱 |
| 设备常驻 token、ragged 长度同步、TRT 临时文件发布 | [[step-audio2-rules]]（rules） | Step-Audio2 专属审查规则 |

### 配置与 checkpoint 差异（三变体）

- `step_audio_2.yaml`：顺序模式（`async_chunk: false`,Token2Wav 等完整 token 集）;thinker TP2 于 "0,1",token2wav 在 "1"。
- `step_audio_2_async_chunk.yaml`：同拓扑改流式（每块 25+3 lookahead）, `max_num_batched_tokens` 缩小。
- `step_audio_2_asr.yaml`：`pipeline: step_audio_2_asr` 单 stage 转写。
- **三份 YAML 都没有 `connectors:` 段**（对照 higgs/mimo）——连接器走框架默认,评审连接器默认值改动时把本家族当受影响方。

### 什么时候查这里

- 审查 step_audio2 的 token 过滤/分块、CosyVoice 栈或 ASR 变体选择;跨家族读 connector meta 时注意本家族 `left_context_size` 的语义陷阱（见 architecture）。
- 语义验收见 [[model-validation]]（model-validation）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/step-audio2/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Step-Audio2（音频 token 内嵌 LM 词表的语音对话）；type: index；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-09-05
- 来源（sources）：PR #5067；PR #5638；PR #5869；PR #5917；PR #6957；vllm_omni/model_executor/models/cosyvoice3/code2wav_core/hifigan.py；vllm_omni/model_executor/models/step_audio2/；vllm_omni/model_executor/models/step_audio2/step_audio2_dit_trt.py；vllm_omni/deploy/step_audio_2.yaml
  - vllm_omni/model_executor/stage_input_processors/step_audio2.py；tests/model_executor/models/step_audio2/test_hift_parity.py；tests/model_executor/models/step_audio2/test_step_audio2_dit_trt.py；vllm_omni/platforms/npu/models/step_audio2_token2wav.py
  - vllm_omni/platforms/npu/models/cosyvoice2_dit_attn.py
