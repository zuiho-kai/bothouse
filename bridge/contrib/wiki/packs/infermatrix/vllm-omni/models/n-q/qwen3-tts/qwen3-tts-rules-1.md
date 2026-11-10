---
name: qwen3-tts-rules-1
description: "Qwen3-TTS 规则（一）：PR 描述信号到源码入口的对照表，Q3TTS-1a ref-audio readiness 按 mode 隔离、1b ICL 反向复用取舍、1c artifact 回归 ready-gate、1d effective task 与 checkpoint variant 对齐（public 400，PR #6113）、2a NPU RoPE 在 BNSD 与 BSND fused path 间选择（PR #5608）"
metadata:
  scope: 只收 Q3TTS-1a 至 1d、2a 与开头的入口对照表；Talker→Code2Wav 分块、decoder state、CUDA Graph 与 adaptive ramp 的 Q3TTS-3a 至 3e 归 qwen3-tts-rules-2，Q3TTS-4a 至 5a 与 PR 规则归 qwen3-tts-rules-3
---
# Qwen3-TTS 规则（1/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/3 部分；第 2 部分 [[qwen3-tts-rules-2]]；第 3 部分 [[qwen3-tts-rules-3]]
- 源页：`knowledge/repos/vllm-omni/models/qwen3-tts/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, serving, qwen-omni；created: 2026-07-20；updated: 2026-10-24
- 来源（sources）：PR #5157；PR #5202；PR #5608；PR #6001；PR #6113；PR #6523；PR #6728；PR #6861；vllm_omni/deploy/aura_omni.yaml；vllm_omni/deploy/qwen3_tts.yaml；vllm_omni/deploy/qwen3_tts_high_concurrency.yaml；vllm_omni/model_executor/models/aura_omni/pipeline.py
  - vllm_omni/model_executor/models/qwen3_tts/qwen3_tts_code2wav.py；vllm_omni/model_executor/models/qwen3_tts/prompt_embeds_builder.py；vllm_omni/model_executor/models/qwen3_tts/segmented_graph_wrapper.py
  - vllm_omni/model_executor/models/qwen3_tts/tokenizer_12hz/modeling_qwen3_tts_tokenizer_v2.py；vllm_omni/model_executor/stage_input_processors/chunk_size_utils.py；vllm_omni/entrypoints/openai/serving_speech.py；vllm_omni/entrypoints/openai/serving_speech_stream.py
  - vllm_omni/entrypoints/openai/speech_usage.py；vllm_omni/entrypoints/openai/tts_adapters/qwen3_tts.py；vllm_omni/model_executor/stage_input_processors/qwen3_tts.py；tests/e2e/online_serving/test_qwen3_tts_base.py；tests/e2e/online_serving/test_qwen3_tts_base_expansion.py
  - tests/entrypoints/openai_api/test_serving_speech.py；tests/entrypoints/openai_api/test_serving_speech_stream.py；tests/entrypoints/openai_api/test_tts_adapter.py；tests/model_executor/models/qwen3_tts/test_qwen3_tts_code2wav.py
  - tests/model_executor/models/qwen3_tts/test_qwen3_tts_incremental_decode.py；tests/model_executor/stage_input_processors/test_qwen3_tts_async_chunk.py；PR #5048；PR #6639；issue #6855；PR #8837；PR #8674；PR #9320
- 置信度（confidence）：high
- 只有 `Q3TTS-数字字母` 是可审计规则 ID。

### Direct 代码快速入口

- （以下为原表格，按行改写为条目）
- PR 描述信号：Qwen3-TTS、`qwen3_tts` pipeline
  - 规则组：Q3TTS-1a/1b
  - 第一批源码：`config/pipeline_registry.py::OMNI_PIPELINES["qwen3_tts"]`；`model_executor/models/qwen3_tts/pipeline.py`
- PR 描述信号：`ref_audio`、stored voice、task/checkpoint variant、x-vector、ICL、artifact-only reuse
  - 规则组：Q3TTS-1a/1b/1c/1d
  - 第一批源码：`entrypoints/openai/tts_adapters/qwen3_tts.py::{validate,_get_model_variant}` → `entrypoints/openai/serving_speech.py::_build_tts_params`、`_qwen3_tts_can_use_ref_audio_artifact_only`、`_track_ref_audio_artifact_warmup`、`_mark_ref_audio_artifact_ready_for_request`
- PR 描述信号：talker/code2wav、adaptive chunk、delta frame、request cache、segmented graph
  - 规则组：Q3TTS-3a/3b/3c/3d/3e + Model Executor
  - 第一批源码：`stage_input_processors/qwen3_tts.py::talker2code2wav_async_chunk` → `stage_input_processors/chunk_size_utils.py` → `qwen3_tts_code2wav.py::Qwen3TTSCode2Wav` → `segmented_graph_wrapper.py`
- PR 描述信号：OpenAI speech adapter
  - 规则组：Q3TTS-1a/1b/1d + Serving
  - 第一批源码：`entrypoints/openai/tts_adapters/qwen3_tts.py::Qwen3TTSAdapter` → `serving_speech.py`
- PR 描述信号：NPU、RoPE、BNSD/BSND、`codec_chunk_ramp`
  - 规则组：Q3TTS-2a
  - 第一批源码：`platforms/npu/models/qwen3_tts_tokenizer_v2.py::_apply_rotary_pos_emb_npu` → `platforms/npu/layers/rotary_embedding.py::npu_rotary_mul_with_bsnd_fallback`

### [Q3TTS-1a] ref-audio readiness 按 mode/capability 隔离

- 触发：同一 `ref_audio` 在 x-vector-only 与 ICL 请求之间复用 artifact。
- 强制：x-vector-only artifact 只证明存在 speaker embedding，不能满足需要 `ref_code` 的 ICL；ICL 请求遇到这种 artifact 时必须保留原始 audio 并重新计算。
- 验收：同一 audio 的 x-vector → ICL 顺序重新计算且 server 存活；x-vector → x-vector 与 ICL → ICL 仍命中 artifact-only reuse。 ^[PR #5157]

### [Q3TTS-1b] ICL 是能力超集，是否反向复用必须显式取舍

- 触发：用 `(artifact_key, x_vector_only)` 等 exact-mode key 简化 readiness。
- 强制：记录 ICL artifact 同时含 `ref_code` 与 speaker embedding，因此理论上可满足 x-vector 请求；若选择 exact-mode 隔离，应把首次 ICL → x-vector 的一次重算视为已知非阻塞性能代价。
- 验收：顺序测试证明 ICL → x-vector 只多一次重算、输出正确且后续同模式复用恢复；若优化为 capability predicate，保留 x-vector artifact 不能服务 ICL 的单向边界。 ^[PR #5157]

### [Q3TTS-1c] ref-audio artifact 回归必须保留 ready-gate 证明

- 触发：移动、合并或重标记同一 `ref_audio` 的 x-vector → ICL artifact regression test。
- 强制：ready lane 必须仍选择 async-chunk server 上的该顺序；每步断言非空 audio，并在 ICL 后再发一次 x-vector 请求以证明 engine 存活。full-model expansion 可以补充覆盖，不能替代 `core_model`/`advanced_model` ready-gate case。
- 验收：ready 的实际 marker selector 收集并执行该 case；x-vector → ICL → x-vector 在同一 audio 下通过，且在旧的 mode-agnostic artifact readiness 实现上失败。 ^[PR #5157] ^[PR #6523]

### [Q3TTS-1d] effective task 必须在 dispatch 前与 checkpoint variant 对齐

- 触发：修改 Qwen3-TTS Speech API 的 `task_type` 推断、uploaded/precomputed voice、checkpoint variant 识别，或 Base prompt 的 speaker embedding 拼接。
- 强制：先确定 effective task：未显式 task 的 `ref_audio`/`ref_text` 选择 Base；uploaded voice 或 `capabilities.precomputed_speakers` 中的 voice 无条件选择 Base，即使 caller 给了另一 task；`capabilities.supported_speakers` 的 built-in preset 仍是 CustomVoice。再以 `hf_config.tts_model_type` field-first 解析已识别 variant；
  - field 缺失或未识别时，才从 model path 的 leaf 向上逐 component 查找 token-delimited marker。识别到 variant 且与 effective task 不同，必须在 engine dispatch 前返回 public 400，明确 task、loaded variant 和可用 alternative；无法识别 variant 返回 `None` 并 fail-open。
- 验收：focused tests 覆盖 uploaded 与 precomputed stored voice（包括 caller 的 conflicting task）、built-in speaker、metadata priority over conflicting/uninformative path、unknown/unrecognized metadata 的 token-delimited leaf-up fallback 与 unknown fail-open，
  - 以及三种 known task/variant mismatch 在 engine dispatch 前为 public 400；另验证 prompt-builder dimension mismatch diagnostic。 ^[PR #6113]

### [Q3TTS-2a] NPU RoPE 按真实 shape 在 BNSD 与 BSND fused path 间选择

- 触发：Qwen3-TTS 12 Hz tokenizer decoder 的 NPU RoPE，尤其启用短 `codec_chunk_ramp` 且提高并发时的短序列 decode。
- 强制：`unsqueeze_dim=1` 的输入合同是 rank-4 BNSD `[B,N,S,D]`。只有 `D` 为偶数、element size 有效且整除 32、`(D/2) % (32/element_size) == 0`，并且 `B*N <= S*8` 时，才保持 BNSD fused fast path，cos/sin 在 axis 1 扩维。
- 强制：合法 rank-4 输入不满足上述 BNSD predicate 时，把 hidden states 以 `transpose(1,2).contiguous()` 转成 BSND `[B,S,N,D]`，cos/sin 在 axis 2 扩维后调用同一 fused `torch_npu.npu_rotary_mul`，再 transpose 回 `[B,N,S,D]`。q 和 k 必须使用同一 helper；`unsqueeze_dim != 1` 的既有调用保持直接 fused 路径。
- 验收：覆盖 `B*N == S*8` 不等式边界两侧、不同 dtype/alignment、rank-4 输入合同、非默认 `unsqueeze_dim`，并把 BNSD fast path 与 BSND fallback 的 q/k 结果同 eager RoPE 做数值 parity。当前测试只把一个 unsupported shape 的 cos/sin dispatch 期望改为 BSND axis，尚无专门的 supported/unsupported 边界矩阵或 eager 数值 parity。 ^[PR #5608]

## 决策与踩坑

- [Q3TTS-1a] 禁止：仅按 `artifact_key` 标 ready 后剥离 `ref_audio`；worker 此时既没有 `ref_code` 也没有输入可补算，会把请求错误升级为 engine failure。
- [Q3TTS-1b] 禁止：把该重算描述为正确性要求，或在未 profiling 前增加复杂 capability 状态机。
- [Q3TTS-1c] 禁止：只因测试正文仍在 expansion 文件，就声称 ready 已覆盖；被 marker selector 排除的 `full_model` case 不构成 ready regression evidence。
- [Q3TTS-1d] 禁止：在 validation 后才把 stored voice 改写为 Base；读取 `server.precomputed_speakers` 而不是 adapter capability；把 `base_models`、`database` 或 parent substring 当 Base marker；让已知 task/variant mismatch 进入 prompt builder。
  - prompt builder 的 speaker-dimension guard 仅保留为绕过 Speech API 时的 diagnostic，仍可能使 EngineCore 终止，不得把它宣传为 service-preserving admission。
- [Q3TTS-2a] 禁止：让短序列/高并发 shape 继续进入会拒绝它的 BNSD tiler；也不能为规避崩溃而让所有 shape 都承担 BSND transpose，丢掉已支持 shape 的 BNSD fast path。共享 helper 的路径是模型无关的，但此 pin 只证明 Qwen3-TTS tokenizer consumer，不能外推到其他模型。
