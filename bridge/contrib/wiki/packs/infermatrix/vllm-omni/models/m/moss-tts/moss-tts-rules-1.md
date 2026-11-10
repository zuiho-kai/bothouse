---
name: moss-tts-rules-1
description: MOSS-TTS 规则（上）：Direct 代码快速入口表，MOSSTTS-1a codec v1/v2 代际与 projection topology 由 checkpoint 原始结构决定、1b codec-v2 NPU RoPE 往返 GPT-J/NeoX pairs、2a Local talker 异步输出固定 shape 与 prefill 边界、2b Local sampler 与 Depth RoPE cache、3a 请求 seed 在 adapter 构造 additional information
metadata:
  scope: 只收快速入口表与 MOSSTTS-1a、1b、2a、2b、3a；reference encoder、waveform LRU、ROCm attention 与 socket 测试归 moss-tts-rules-2
---
# MOSS-TTS 规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/2 部分；第 2 部分 [[moss-tts-rules-2]]
- 源页：`knowledge/repos/vllm-omni/models/moss-tts/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-09-02；updated: 2026-10-06
- 来源（sources）：PR #5635；PR #6908；vllm_omni/model_executor/models/moss_tts/modeling_moss_tts_codec.py；vllm_omni/model_executor/models/moss_tts/audio_tokenizer.py；PR #6241；vllm_omni/model_executor/models/moss_tts/modeling_moss_tts_local.py
  - vllm_omni/model_executor/models/moss_tts/modeling_moss_tts_local_depth.py；vllm_omni/model_executor/models/moss_tts/modeling_moss_tts_talker.py；PR #6543；PR #4982；vllm_omni/entrypoints/openai/tts_adapters/moss_tts.py；vllm_omni/entrypoints/openai/serving_speech.py
  - vllm_omni/model_executor/models/moss_tts/reference_encoder.py；vllm_omni/model_executor/models/moss_tts_nano/modeling_moss_tts_nano.py；tests/entrypoints/openai_api/test_tts_adapter.py；tests/entrypoints/openai_api/test_serving_speech.py
  - tests/model_executor/models/moss_tts/test_reference_encoder.py；PR #7885；PR #8463；PR #8447
- 置信度（confidence）：high
- 只有 `MOSSTTS-数字字母` 是可审计规则 ID。

### Direct 代码快速入口

| PR 描述信号 | 规则 | 第一批源码 |
|---|---|---|
| codec v1/v2、`number_channels`、missing weights | `MOSSTTS-1a` | `modeling_moss_tts_codec.py::MossTTSCodecDecoder._build_codec` → Stage-1 weight loader |
| codec-v2 NPU RoPE、`npu_rotary_mul`、GPT-J pairs | `MOSSTTS-1b` | `audio_tokenizer_v2.py::apply_rope` |
| `_ProjectedTransformer`、`in_proj`/`out_proj`、Identity | `MOSSTTS-1a` | `audio_tokenizer.py::_ProjectedTransformer` → codec checkpoint parameter names |
| online request `seed`、adapter additional information、Nano/Local/Delay/Realtime reproducibility | `MOSSTTS-3a` | `tts_adapters/moss_tts.py::_MossTTSAdapterBase.build` → variant model seed/RNG consumer |
| reference audio cache、single-flight、micro-batch、TTSD 两 speaker | `MOSSTTS-4a` | `reference_encoder.py::MossReferenceEncoder` → `serving_speech.py::_encode_moss_references` |

### [MOSSTTS-1a] codec 代际与 module topology 必须由 checkpoint 原始结构决定

- 触发：MOSS Stage-1 codec config 解析、v1/v2 类选择、vendored tokenizer module 或 checkpoint missing/shape-mismatch validation。
- 强制：先用 `MossAudioTokenizerV2Config.get_config_dict(codec_path)` 读取 raw config；只有 raw `number_channels >= 2` 才尝试 v2 config/model。字段缺失按 `1` 判为 v1，直接使用 `MossAudioTokenizerConfig`/`MossAudioTokenizerModel`，不能让两代共享的 `model_type` 或 v2 config 的默认双通道值替 checkpoint 决定代际。
- 强制：v2 config/model 构造失败时记录异常并显式回退 v1；raw config 读取本身在选择前完成，其失败不得伪装成某一代成功。`_ProjectedTransformer` 的 `in_proj` 仅在 `input_dimension != d_model` 时为无 bias `Linear`，否则为 `Identity`；`out_proj` 对 `output_dimension != d_model` 使用同一规则。module topology 与 checkpoint parameter 集必须一致。
- 验收：覆盖 raw config 字段缺失/单通道/v2 双通道、v2 构造失败回退、equal/unequal input 与 output dimensions，并断言 model class、projection 类型、参数名、weight completeness 和 forward shape。PR 只提供 Ascend NPU 手工 load/audio 验证，未新增这些自动化回归。 ^[PR #5635]
- 共享 loader 的 dtype/config 最小读取合同见 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（Model Executor rules）。

### [MOSSTTS-1b] codec-v2 NPU RoPE 必须显式往返 GPT-J 与 NeoX pairs

- 触发：codec-v2 `apply_rope`、time-before-heads broadcast、NPU kernel 或 RoPE table 变更。
- 强制：保留 GPT-J interleaved pairs。NPU 从 `freqs*ts` 建 `cos_d2`/`sin_d2`、duplicate halves至 NeoX width，将 q/k 经 view-transpose-reshape-contiguous 变为 NeoX，分别 lazy-import `torch_npu.npu_rotary_mul`，再 inverse-permute 为 contiguous GPT-J；保持 time-before-heads shape/broadcast。non-NPU 保持 eager FP32 GPT-J；
  - NPU import/kernel failure fail closed，无 recoverable fallback。
- 验收：真实 NPU parity 与 non-NPU fallback 不变；target 无自动测试，只有作者 910B2C 观察，不能外推质量/性能。^[PR #6908]

### [MOSSTTS-2a] Local talker 异步输出必须保持固定 shape 和 prefill 边界

- 触发：修改 MOSS-TTS Local talker 的 `make_omni_output`、`compute_logits`、`preprocess`、async chunk 或 CUDA Graph/async schedule。
- 强制：只有在每个 request row 保持固定 shape 且状态更新可在 eager 阶段完成时启用 `use_async_omni_output`；`make_omni_output` 必须按原 batch 顺序保留每个 request 的 code row，包括全 `audio_pad_token_id` 的 stop row，并逐行生成 `_batch_should_continue`，再由 CPU 侧 `talker2codec_raw_async_chunk` 过滤全 pad row。
  - `_omni_is_prefill` 为真时即使 span 只有一个 token 也必须走 embedding prefill，不生成 MTP/audio 输入，并保持 `ref_offset` 与 audio state 的既有更新语义。
- 验收：mixed batch 同时覆盖有效 row 与 stop row，断言 row 数、shape、原 batch 对齐和 `_batch_should_continue` 值，并确认下游只过滤全 pad row；单 token prefill 断言 embedding 结果、无 `mtp_inputs` 且不推进 audio generation；async output/graph 路径验证不存在 host 动态 shape discovery，状态与输出均可正确交付。 ^[PR #6241]

### [MOSSTTS-2b] Local sampler 与 Depth RoPE cache 必须保持直接路径及数值边界

- 触发：修改 MOSS-TTS Local 的 `_sample_token`、Local Depth attention RoPE、`torch.compile`/CUDA Graph capture，或为这些优化增加运行时开关。
- 强制：在 `_run_prefix` 编译或 talker capture 前，为每个 Local Depth attention 预先构造位置 `0..n_vq-1` 的非持久 RoPE cache（当前 Local v1.5 为 `0..11`），执行时只切片并让较短序列复用既有 allocation；compact top-k 必须在保留的 sorted candidates 上完成 nucleus filtering、softmax 和 multinomial，再将 compact index 映射回原始词表。
- 验收：RoPE 测试与参考公式数值一致，较短 slice 保持 cache storage；capture 前确认完整 cache 已物化且执行体只使用切片。采样测试断言结果属于 retained top-k、极小 `top_p` 选择 argmax，并在无 ties 时核对分布语义；质量或回归记录必须明确 compact width 改变 RNG 映射后的非 seed/bit-equivalence 边界。 ^[PR #6241]

### [MOSSTTS-3a] 请求 seed 先在 adapter 构造 additional information，再判定模型 consumer

- 触发：修改 MOSS-TTS OpenAI adapter、speech request seed propagation、`additional_information`，或宣称任一 MOSS 变体的 request-seed 可复现性。
- 强制：`_MossTTSAdapterBase.build()` 在 shared speech path 将 request seed 写入 `SamplingParams` 之前，优先把显式 `request.seed`（包括 `0`）写为 `tts_params["seed"]`；request 未提供 seed 时才回退 stage-0 sampling default。分别追踪 consumer：Nano 从该 additional information 读取 seed；Local 经 `tts_local_seed` 和逐请求 generator；
  - Delay 和 Realtime 需要各自的 request-scoped RNG/generator plumbing 才能获得模型侧效果。
- 验收：对 `MossTTSAdapter` 与 `MossTTSNanoAdapter` 都覆盖 `seed=0`、非零 request seed 覆盖 stage default，且 request 缺省时回退 default；模型级结论分别验证 consumer。Nano 的并发异 seed 隔离需要在 shipping `max_num_seqs=4` 下单独以 per-request generator 验证，不能由 adapter CPU contract 或单请求结果推出。^[PR #6543]

## 决策与踩坑

- [MOSSTTS-1a] 禁止：总是先实例化 v2 来“探测”版本；用偶然通过的 frame-rate validation 证明类正确；dimensions 相等时额外创建 checkpoint 不含的 learned projection，或无条件用 Identity 丢掉 dimensions 不等时的权重。
- [MOSSTTS-1b] 禁止：直接给 kernel interleaved/noncontiguous input、改 pairing、只转 q/k 一侧，或改变 CPU/GPU path。
- [MOSSTTS-2a] 禁止：在 GPU 上使用 `codes[should_continue]` 或其他会发现动态输出 shape 的 boolean indexing；在模型侧提前丢弃全 pad row；仅凭 `span_len` 判断单 token prefill；或在 async output 模式下延迟仍会被下一步覆盖的模型状态更新。
- [MOSSTTS-2b] 禁止：在每个 depth step 内重复执行 `arange`/`einsum`/`cos`/`sin`，在 captured body 中构造或替换 cache，或用环境变量把这些直接实现伪装成可选路径；不得声称 compact sampler 与宽度 1024 的 multinomial 在 seed 或 bit 上等价，也不得忽略 top-k 边界 ties 的有限精度差异。
- [MOSSTTS-3a] 禁止：用 truthiness 丢弃 `seed=0`；把 adapter 的 shared contract test 当作 full-family end-to-end reproducibility 证据；把 Local 的既有路径说成此 adapter 修复；或忽略 Nano 以 global torch RNG 在并发请求间互相重置的限制。
