---
name: step-audio2-architecture
description: "Step-Audio2 架构：入口包装按 model_stage 分发、Whisper 风格 AudioEncoder + Adaptor 的 thinker、CosyVoice 风格 token2wav（s3tokenizer、ONNX 说话人嵌入、10 步 flow-matching、树内 HiFT）、纯 token 过滤交接（音频 token 151696–158257）、async_chunk 的 25+3 lookahead 与 left_context_size 作 last_chunk 布尔的跨家族陷阱（PR #5917）、DiT TRT 原子发布（PR #6957）、验证入口与已知未决"
metadata:
  scope: 只收 Step-Audio2 的模块边界、stage 交接、流式数据流、验证入口与已知未决；变体与入口速览归 step-audio2-overview，设备边界与 TRT 发布的可执行规则归 step-audio2-rules
---
# Step-Audio2 架构

## 现状

- 事实在 `main @ bfe8967c` 复核;变体/入口速览见 [[step-audio2-overview]]（index），设备边界与同步验收见 [[step-audio2-rules]]（rules）。

### 模型专有部分与共享模块的边界

- 入口包装（`step_audio2.py`）：注册进 `MULTIMODAL_REGISTRY`;把 `model_stage` `"step_audio2_thinker"` 规范化为 `"thinker"`,按 stage 经 `init_vllm_registered_model` 分发到 thinker / token2wav,未知 stage 直接 raise;`get_language_model()` 在 stage 1 返回 adapter 自身。
- 专有 thinker（`step_audio2_thinker.py`）：Whisper 风格 AudioEncoder + Adaptor 下采样进 LLM;**backbone 由 checkpoint `text_config.architectures` 经 `init_vllm_registered_model` 决定**（qwen2/qwen2_5 fallback 映射,家族不硬编码 backbone 类）;音频嵌入并入 `<audio_patch>`（id 151690）位置。
- 专有 token2wav（`step_audio2_token2wav.py`）：CosyVoice 风格栈—— s3tokenizer（prompt wav 语音 token）+ ONNX 说话人嵌入 + hyperpyyaml 加载的 flow-matching（10 步 ODE）+ 树内 CosyVoice3 HiFT/mel 实现 → 24 kHz;树内带说话人 wav——`assets/default_female.wav` 是默认,`default_male.wav` 是备选。
- 共享加速实现：`step_audio2_dit_trt.py` 提供流式 DiT ONNX export/TRT stepper，并以同目录独占临时文件发布 ONNX/plan（成功时原子 replace、并发 last-writer-wins）；`step_audio2_token2wav.py` 提供 Campplus TRT helper。在此 pin 上只有 MiniCPM-o 的 Code2Wav wiring 显式启用它们，Step-Audio2 pipeline 不会因共享代码存在而自动切换；
  - 发布器不提供锁、fsync/目录持久化、内容校验或 ONNX/plan 成对事务。^[PR #6957]
- 常量单一来源 `step_audio2_constants.py`：文本 ≤151688;音频 token **151696–158257**（`audio_vocab_size` 6562,相对 `audio_eos` 6561）;流式 `chunk_size 25` / `pre_lookahead_len 3` / mel cache 8 帧。
- 共享：[[configuration-architecture]]（Config 组件）; `serving_speech.py` 的 TTS 入口。

### 配置、checkpoint 和兼容范围

- checkpoint 合同：文档/示例指向 `stepfun-ai/Step-Audio-2-mini`,三份 deploy YAML 均不 pin;token 常量声明跨 mini/7B 不变（`step_audio2_constants.py` docstring）。
- **stage 交接是纯 token 过滤,无 hidden-state 交接**（docstring 明确对照 Qwen3-Omni）：thinker 的 LM 输出流内嵌音频 token,处理器筛 ≥151696 的 id、减 `audio_start` 转 0 基、丢 ≥6561 的 EOS/padding;无音频 token 的请求跳过 stage 1。
- token2wav 以**伪 LM stage** 运行：LLM_GENERATION + `max_tokens: 1` + `hf_overrides` 换架构;`get_language_model()` 故意返回 adapter 自身。
- ASR 变体是 pipeline 对象差异（单 stage,`engine_output_type="text"`）, 模型代码同一份。

### 从输入到输出的主要流程

1. 音频进 mel（n_mels 128）→ AudioEncoder → Adaptor → `<audio_patch>` 位置合并;thinker 解码出文本+音频混合 token 流（文本同时 final 交付）。
2. 交接两条路：sync 路 `thinker2token2wav` 在 thinker 完成后一次性过滤全部音频 token,token2wav 走完整 `forward` 离线合成（无音频 token 的请求跳过 stage 1;ASR pipeline 根本没有 stage 1,thinker 文本即终点）。
   - async_chunk 路只扫 decode token（prompt 里可能有历史轮的音频 token）;**每个非末块要 `chunk_size+pre_lookahead_len`（25+3）个 token,但消费指针只推进 25**—— 3 个 lookahead 被刻意重发给下一块（conformer 编码器需要未来 token,内部缓存）;末块发送全部剩余 token,纯文本完成发空 EOF 载荷。与 higgs/mimo 的左上下文滑窗是不同机制。
3. **跨家族陷阱**：本家族由 runtime additional-information 条目的嵌套 `meta.left_context_size` 识别 async-chunk；只要该值存在（包括非末块的 `0`）就进入 token2wav 流式路径。它复用为"是否末块"布尔（`0/1`），**不是重叠帧数**；`1` 传给 core 作为 `last_chunk`，而读 connector 元数据的共享代码不得按 higgs/mimo 语义解释。空 EOF 仍返回一个零 waveform chunk，并不因本次 metadata 路由修复改变。^[PR #5917]
4. token2wav 流式:`_StreamState`（mel cache 160 ms、source cache 3840 样本、estimator cache 窗 100）,块缝用 Hamming `fade_in_out` 平滑。

### 怎样验证功能、精度和性能

- pin 上只有**功能面**验证入口;无精度基线或性能 gate 证据,下列测试不覆盖精度/性能维度,相关结论需另行实测。
- 单元：`tests/model_executor/models/step_audio2/`（thinker、token2wav async chunk、`test_step_audio2_dit_trt.py` 的 CPU 原子发布）、`tests/model_executor/stage_input_processors/test_step_audio2_async_chunk.py`;
  - NPU:`tests/platforms/npu/test_step_audio2_token2wav.py`;parser: `tests/reasoning/test_step_audio_reasoning_parser.py`。
- e2e：`tests/e2e/{offline_inference,online_serving}/test_step_audio2_expansion.py`（各带 `stage_configs/step_audio2_ci.yaml`）;示例 `examples/{offline_inference,online_serving}/step_audio2/`。
- 已知未决：无 `connectors:` 段时框架默认值来源未追; `STEP_AUDIO2_DEFAULT_PROMPT_WAV` 注释称可被 env 覆盖但常量文件本身不读 env,覆盖机制未定位;stage 0 未配置 `stop_token_ids`,音频发射如何终止是运行期行为,pin 上未验证。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/step-audio2/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-09-05
- 来源（sources）：PR #5067；PR #5638；PR #5869；PR #5917；PR #6957；vllm_omni/model_executor/models/cosyvoice3/code2wav_core/hifigan.py；vllm_omni/model_executor/models/step_audio2/step_audio2_thinker.py；vllm_omni/model_executor/models/step_audio2/step_audio2_token2wav.py
  - vllm_omni/model_executor/models/step_audio2/step_audio2_dit_trt.py；vllm_omni/model_executor/models/step_audio2/step_audio2_constants.py；vllm_omni/model_executor/stage_input_processors/step_audio2.py；tests/model_executor/models/step_audio2/test_hift_parity.py
  - tests/model_executor/models/step_audio2/test_step_audio2_token2wav_async_chunk.py；tests/model_executor/models/step_audio2/test_step_audio2_dit_trt.py
