---
name: cosyvoice3-architecture
description: "CosyVoice3 架构（main @ 39c16d75）：talker（Qwen2 系 AR 出 speech token）与 code2wav（CFM + DiT + HiFT）的专有边界、campplus 与 CFM 估计器的 TensorRT 加速、CFM plan 的 os.replace 发布（PR #6955）与 TRT stream handoff（PR #5673）、RAS 停止机制（6562 接收 200 个停止 logit 的 logsumexp，repetition_penalty 1.0001 不可归一化）、双交接注册的主流程、验证入口与非有限 logits guard（PR #6424）、已知未决"
metadata:
  scope: 只收 CosyVoice3 的模块边界、配置合同、数据流和验证现状；入口与运行模式速览归 cosyvoice3-overview，TRT handoff 与 plan 发布的可执行约束归 cosyvoice3-rules
---
# CosyVoice3 架构

## 现状

- 事实在 `main @ 39c16d75` 复核;入口/模式速览见 [[cosyvoice3-overview]]（index）。

### 模型专有部分与共享模块的边界

- talker：`VLLMQwen2Encoder` → `TransformerLM` → `Qwen2LM` → `CosyVoice3LM`（Qwen2 系 AR,出 speech token）;参考音频条件作为多模态数据进入（自有 MultiModalProcessor）。
- code2wav：`CausalConditionalCFM`/`CausalMaskedDiffWithDiT`（流匹配,DiT 估计器 import 自 `diffusion/models/cosyvoice3_audio/`）+ `PreLookaheadLayer` + `CausalHiFTGenerator`（HiFT/NSF 声码器）+ `CausalConvRNNF0Predictor`。
- **TRT 加速（本清单独有）**：campplus 说话人嵌入与 CFM DiT 估计器都可走 TensorRT（启动时 ONNX→plan,按设备缓存 plan;campplus 有 CPU-ONNX 兜底）, 统一由 `COSYVOICE3_TRT` 门控,默认开。
- **CFM plan 发布**：flow-estimator builder 先序列化 engine bytes，再经自有、同目录的独占临时 plan 写入并 close，最后以 `os.replace` 发布至缓存路径；因此并发 builder 可各自完成 artifact，最终缓存允许 last-writer-wins。失败清理仅处理 writer 自己创建的 tmp，不承担缓存协调或持久化职责；具体改动约束见 [[cosyvoice3-rules]]（rules）。^[PR #6955]
- **CFM TensorRT handoff**：每个 execution context 与一个原始 `torch.cuda.Stream` 成对入池；caller stream 先由该 stream 的 `wait_stream` 建立 producer→TensorRT 依赖，TRT 在该 stream 的 raw `cuda_stream` handle 上 enqueue。
  - 返回前 caller 对 estimator stream 再 `wait_stream`，所以后续 CFG buffer 原地写入和 output dtype conversion 在 consumer stream 上发生在 TRT 后。所有供 raw pointer binding 的输入/输出都 record estimator stream；输出还 record caller stream，分别覆盖 enqueue 前后 allocator reuse。
  - context 可在 enqueue 后回池，因为它始终与专属 stream 成对且 TensorRT 已 snapshot 地址；这不是 host synchronize。`torch.nn.Module` estimator 路径和 `COSYVOICE3_TRT` 的既有关闭/CPU fallback 不在这个非-module TensorRT 分支中改变。具体改动约束见 [[cosyvoice3-rules]]（rules）。^[PR #5673]
- 共享：diffusion Attention 层、SharedMemoryConnector、[[configuration-architecture]]（Config 组件）。

### 配置、checkpoint 和兼容范围

- checkpoint：YAML 不 pin;离线示例仅以注释给出默认 `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`。
- config（`transformers_utils/configs/cosyvoice3.py`）：`eos_token_id` 默认 6562;注释明确官方把 **所有 ≥ speech_token_size 的 token（6561–6760）都视为停止信号**;`sample_rate 24000`、hidden 896、query heads 14、KV heads 2 硬编码。
- **RAS 停止机制（停止失效 bug 类别）**：停止 token id **6562 接收 200 个停止 logit 的 logsumexp 合并分数**;YAML 的 `repetition_penalty: 1.0001` 唯一存在理由是逼 vLLM 维护 `output_token_ids` 让 RAS 生效——把它"归一化"成 1.0 会静默破坏停止。
- stage-1 的 `engine_output_type="latent"`（而非其他 TTS 家族的 `"audio"`）与 `final_output_type="audio"` 并存——是刻意合同还是陈旧字段 pin 上无注释,未决。

### 从输入到输出的主要流程

1. 文本 + 参考音频作为多模态条件进入（campplus 说话人嵌入与 speech_feat/speech_token 条件张量打进 `additional_information`）；共享 serializer 以原始 `uint8` storage + recorded PyTorch dtype/shape 往返，因此 BF16 保持 bit-exact，shared decoder 还原 dotted nested keys（如 `embed.speech_token`）后交给 stage processor。
2. talker AR 出 speech token（词表 6561,合并停止 6562）。
3. 交接双注册（**唯一同时注册两条交接的家族**,由 `deploy.async_chunk` 选）:
   - 流式 `talker2code2wav_async_chunk`：prompt 条件按 chunk 对齐（`prompt_token_pad`）,`codec_pre_lookahead_frames 3`,hop 以 `codec_stream_scale_factor 2` 增长,上限 4× chunk;批发射的右 padding 先 `unpad_prompt_conditioning` 剥掉。
   - 同步 `text2flow_full_payload`（生产侧全载荷）+ `text2flow_token_only`（消费侧占位）。
4. code2wav：flow-matching 解码器产出声学特征 → HiFT → 24 kHz 波形（TRT 估计器与 PyTorch DiT 之间的具体选路代码未逐行读,见文末未决项）。

### 怎样验证功能、精度和性能

- 本次调查识别到的验证入口都是**功能面**（e2e/SIP）;未发现精度基线或性能 gate（YAML 头注的 H100/H20-3e 连续性数字是部署调参记录,非精度基线）—— 精度/性能结论需另行实测。
- e2e：`tests/e2e/offline_inference/test_cosyvoice3_expansion.py`、`tests/e2e/online_serving/test_cosyvoice3_tts_expansion.py`;SIP `tests/model_executor/stage_input_processors/test_cosyvoice3_stage_input_processors.py`（资产 `tests/assets/cosyvoice3/zero_shot_prompt.wav`）;
  - 示例 `examples/{offline_inference,online_serving}/text_to_speech/cosyvoice3/`。
- 采样在 request mask 和 logits processor 之后排除 NaN/±inf；整行没有 finite candidate 必须 fail loudly 而不能抽样随机 speech。该 guard 每 sampler batch 有一次 device sync，且不同于 `torch.multinomial` 的 vLLM sampler 可改变固定 seed 的 token 序列。RAS 仅剩合法 token 时必须恢复 clone 的原 score，不能从 all-`-inf` softmax 抽样。^[PR #6424]
- 最新 head 的真实权重证据覆盖 H20 CUDA graph/attention 与 MI300X Triton/AITER，dummy 权重也在 H20/MI300X 通过；没有 H100/MI325 复测，且这些运行都未使用 TensorRT campplus，不能外推到该硬件或 TRT 路径。`+inf` 被当作非法值排除、无 finite 行会杀死 EngineCore 而非只 abort 单请求，仍是 follow-up。
- 已知未决：6563–6760 的实际停止行为依赖 talker `compute_logits` 的合并逻辑（只略读）;NPU 侧 `cosyvoice2_dit_attn.py`（名字是 cosyvoice2）是否接到 v3 DiT 路径未追;code2wav 内 TRT/PyTorch 选择的具体代码未逐行读。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/cosyvoice3/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-09-05
- 来源（sources）：PR #5673；PR #6424；PR #6955；vllm_omni/data_entry_keys.py；vllm_omni/model_executor/models/cosyvoice3/cosyvoice3.py；vllm_omni/model_executor/models/cosyvoice3/cosyvoice3_code2wav.py；vllm_omni/model_executor/models/cosyvoice3/code2wav_core/cfm.py
  - vllm_omni/model_executor/models/cosyvoice3/code2wav_core/hifigan.py；vllm_omni/model_executor/models/cosyvoice3/flow_estimator_trt.py；vllm_omni/model_executor/models/cosyvoice3/pipeline.py；vllm_omni/model_executor/stage_input_processors/cosyvoice3.py
  - vllm_omni/transformers_utils/configs/cosyvoice3.py；vllm_omni/deploy/cosyvoice3.yaml
