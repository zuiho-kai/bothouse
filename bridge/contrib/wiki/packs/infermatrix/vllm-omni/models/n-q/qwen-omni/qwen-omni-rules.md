---
name: qwen-omni-rules
description: Qwen-Omni 规则：QOMNI-1a Thinker MRoPE CUDA custom-op 边界、1b 嵌套 stage 量化名称映射一次、1c Instruct thinker-only 静态 pipeline key、1d audio encoder TP 回退、1e Qwen2.5 code2wav soft-fail、1f MoE backend 默认值、1g code predictor rope_theta、1h moe_backend 显式字段、1h2 Thinker PP 层捕获、1h3 混长 crop、1h4 residual 捕获、1i accept-hidden 层读 config
metadata:
  scope: 只收 QOMNI-1a 至 1i（含 1h2 / 1h3 / 1h4）及开头的 PR 描述信号表；Realtime 近似对齐 QOMNI-2a 归 rules-realtime，MRV2、INPUT、EMBED、TOKEN2WAV 规则各归 qwen-omni-rules-mrv2-audio、rules-thinker-input、rules-embedding-capture、rules-token2wav-attention
---
# Qwen-Omni 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen-omni/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, qwen-omni；created: 2026-09-04；updated: 2026-10-09
- 来源（sources）：PR #5687；PR #6284；PR #6449；PR #4322；PR #6748；PR #6886；PR #7019；vllm_omni/config/pipeline_registry.py；vllm_omni/deploy/qwen3_omni_moe.yaml；vllm_omni/deploy/qwen3_omni_moe_thinking.yaml；vllm_omni/engine/stage_init_utils.py；vllm_omni/model_executor/models/qwen2_5_omni/qwen2_5_omni.py
  - vllm_omni/model_executor/models/qwen3_omni/quantization.py；vllm_omni/model_executor/models/qwen3_omni/qwen3_omni.py；vllm_omni/model_executor/models/qwen3_omni/qwen3_omni_moe_thinker.py；vllm_omni/quantization/component_config.py；tests/config/test_config_factory.py
  - tests/diffusion/quantization/test_component_routing.py；tests/engine/test_stage_engine_args.py；tests/model_executor/models/qwen3_omni/test_qwen3_omni_quantization.py；PR #7228；PR #7200；PR #7345；PR #7340；PR #7304；PR #5825
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| MRoPE、quantization mapping、pipeline key、audio TP、code2wav、backend defaults 或 code-predictor RoPE theta | `QOMNI-1a`–`QOMNI-1g` |

### [QOMNI-1a] Qwen3-Omni Thinker MRoPE 必须保留 CUDA custom-op 边界

- 触发：修改 `qwen3_omni_moe.yaml` 的 CUDA compilation 配置、Thinker MRoPE/RMSNorm 路径，或升级会改变 Inductor MRoPE fusion 的 vLLM 版本。
- 强制：CUDA platform overlay 仅为 Thinker stage 0 设置 `compilation_config.custom_ops: ["+rotary_embedding"]`，保持 MRoPE 在 CUDA/Triton custom-op 边界后；Talker/Code2Wav 与 CPU、MUSA、NPU、ROCm、XPU 配置不得继承此 override。
- 验收：经 `_apply_platform_overrides → merge_pipeline_deploy` 断言 CUDA 仅 stage 0 有该 custom op、其余 stage/平台均无；固定 seed 下与 eager oracle 的 thinker/talker/codec 离散轨迹必须完全一致，并验证生成 WAV 逐字节一致。
  - 相关配置展开见 [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（Configuration rules），家族 topology 见 [[qwen-omni-architecture]]（architecture）。^[PR #6449]

### [QOMNI-1b] Qwen3-Omni 嵌套 stage 的量化名称只能在统一 wrapper 映射一次

- 触发：修改 Qwen3-Omni 的 `SupportsQuant`、`WeightsMapper`、compressed-tensors/AWQ ignore/exclude 名称，或 Thinker、Talker、Code2Wav 的嵌套模型构造。
- 强制：在统一 Qwen3-Omni wrapper 暴露 checkpoint 到最终嵌套模块路径的映射，并先对完整 quantization config 执行一次映射；`ComponentQuantizationConfig` 必须递归映射每个非空 component 和 default config。子 stage 检测到该映射后不得再次改写名称，但仍须合并自己的 `packed_modules_mapping`，供量化 scheme 匹配 fused module。
  - 该嵌套 metadata 是 optional：outer-map-once marker 已存在时，缺少 attribute 必须 no-op；存在且非空时才 merge，且不得清掉 outer marker。
- 验收：以真实 component-wrapped `CompressedTensorsConfig`（含 `None` component 与 default）断言 `ignore` HF names 映射到最终路径；加载 AWQ checkpoint 时三 stage 都能完成 weight loading，且不出现缺模块/参数或 routed-expert quantized-weight 属性错误。
  - CPU regression 还必须覆盖 missing quant config、outer-mapped Talker-style model 缺 `packed_modules_mapping` 的 no-op、及 present mapping merge；这只是 mapping/metadata contract，不是 quant scheme、kernel、quality 或 performance evidence。^[PR #5687] ^[PR #6748]

### [QOMNI-1c] Instruct 的 thinker-only deploy 必须选择静态 pipeline key

- 触发：修改 Qwen3-Omni 的 pipeline registry、`qwen3_omni_moe_thinking.yaml`，或依赖 `enable_audio_output` 自动拓扑选择的 serve/config-factory 路径。
- 强制：需要 Instruct 权重只加载 Thinker 时，deploy YAML 必须显式设 `pipeline: qwen3_omni_moe_thinker_only`；该 registry key 必须直接绑定静态单 stage text→text `PipelineConfig`，不能重新进入由 HF config 决定全三 stage 的 `qwen3_omni_moe` resolver。没有显式 YAML 的 Captioner/Thinking checkpoint 继续由 resolver 自动选择 thinker-only 拓扑。
- 验收：分别以 Instruct 和 Thinking/Captioner HF config 经 `StageConfigFactory` 加载该 YAML，断言同一 `qwen3_omni_moe_thinker_only` pipeline、仅一个 Thinker stage 和 text output；同时直接解析该 key，断言其对象身份为 registry 的静态 `PipelineConfig` 而非 resolver 结果。PR 只有这类配置单元测试，未提供真实 `vllm serve`、质量、性能或资源证据。^[PR #6284]

### [QOMNI-1d] audio encoder TP 必须按 head divisibility 局部回退

- 触发：修改 Qwen3-Omni audio encoder 的 attention/FFN parallel linear、`encoder_attention_heads`，或其 global tensor-parallel 初始化。
- 强制：以 `encoder_attention_heads % global_tp_size` 判定该 audio-encoder layer 是否可分片。可整除时保持 global TP；不可整除时仅该 encoder layer 的 attention QKV、attention output projection、FC1 和 FC2 都以 `disable_tp=True` 构造，且 local attention head count 按 effective TP=1 计算。
- 验收：分别覆盖 heads 可被和不可被 global TP 整除的构造，断言四个 linear 的 `disable_tp` 一致、attention local-head count 正确，且 encoder 外的 Thinker/Talker TP 配置未被此条件改写。PR 仅报告手工请求与整体 workload 测量，未给出该局部回退的独立性能或质量证明。^[PR #4322]

### [QOMNI-1e] Qwen2.5-Omni code2wav 缺失时必须 soft-fail，不能复活跨 stage 的旧 speech helper

- 触发：修改 Qwen2.5-Omni 的 `generate_audio`、`_codec_to_audio`、`_init_token2wav_model`、weight loading、Talker sampling/logits，或 Thinker/Talker/Code2Wav 的 staged 构造。
- 强制：`_codec_to_audio` 在 `token2wav` 缺失时必须直接返回 `None`；`_init_token2wav_model` 只能由持有已解析 `hf_model_folder` 的 Token2Wav weight-loading 路径调用；语音生成维持 Thinker → Talker → Code2Wav 的 stage handoff。
- 验收：目标树中不存在两个已删除 helper 或无参数 initializer call；`token2wav is None` 的 `_codec_to_audio` 路径返回 `None` 而非 `TypeError`；Token2Wav load path 仍向 initializer 传入解析后的 HF directory。PR 未新增测试或 E2E，故这些是静态/call-site 合同，不构成运行时、音频质量或性能证据。^[PR #6886]

### [QOMNI-1f] Qwen3-Omni MoE 默认值必须走显式 backend 合同

- 触发：修改 Qwen3-Omni Thinker/Talker 的 MoE backend、`qwen3_omni_moe.yaml`、stage-engine argument finalization，或迁移旧的环境变量 workaround。
- 强制：仅当 `model_arch` 为 `Qwen3OmniMoeForConditionalGeneration` 且已解析的 `moe_backend` 为缺失或 `auto` 时，finalization 才默认写入 `triton`；任何显式 backend 必须原样保留。随仓库发布的 `qwen3_omni_moe.yaml` 必须在 Thinker stage 0 和 Talker stage 1 都显式 pin `moe_backend: triton`；Code2Wav 不继承该模型专属 MoE 设置。
- 验收：以 Qwen3-Omni default 和一个显式 backend control，分别经 `build_legacy_engine_args_dict` 与 `build_engine_args_dict_from_omni_stage_config` 断言最终 `moe_backend`；默认两路径均为 `triton`，显式值不变。helper 单测只能补充分支覆盖，不能代替 builder-level assertion。
  - PR 只提供 compile/Ruff/diff 检查及因缺少 `torch` 未运行的 targeted pytest，故不构成 GPU 稳定性、性能或音频质量证据。^[PR #7019]

### [QOMNI-1g] 共享 code predictor 的 RoPE theta 必须先读 rope_parameters

- 触发：修改 `qwen3_code_predictor._RotaryEmbedding`、Qwen3-Omni Talker code predictor config 反序列化，或 Transformers 对 `rope_theta`/`rope_parameters` 的布局。
- 强制：构造 `inv_freq` 时优先 `config.rope_parameters["rope_theta"]`（若 mapping 存在），否则回退 top-level `rope_theta`，再默认 `10000.0`。Qwen3-Omni（Transformers 5.10+ 常把 checkpoint 的 `1_000_000` 只放在 nested 字段）与仍带 top-level 的 Qwen3-TTS/legacy 必须共用该顺序。
- 验收：参数化覆盖 nested-only、nested 优先于冲突 top-level、默认 `10000`，以及 TTS/legacy top-level（含删除 `rope_parameters`）重建正确 `inv_freq`。^[PR #7228]

### [QOMNI-1h] Qwen3-Omni 的 moe_backend 覆盖只认显式字段，字面 auto 不算隐式

- 触发：修改 `_maybe_set_qwen3_omni_moe_backend`、`OmniStageModelConfig` 的 `_TrackExplicitConfigFields`/`_omni_explicit_fields`，量化/NVFP4 deploy，或 stage engine-args 投影时机。
- 强制：仅当 `moe_backend` 不在显式字段集合（typed 读 `_omni_explicit_fields`；dict 路径 key 缺失）时才默认写入 `triton`；deploy/CLI 显式写出的 `moe_backend: auto` 必须原样保留，交给 vLLM 量化 backend 选择。覆盖应在 stage projection 时带上 explicitness，不得仅靠 finalize 再猜字面值。
- 验收：显式 `auto`、显式非 auto、未设置三路径分别经 legacy 与 typed builder；NVFP4 CI stage 0 最终为 `auto`，未量化默认 stage 仍为 `triton`。^[PR #7200]

### [QOMNI-1h2] Thinker PP 必须把层捕获装进 IntermediateTensors 并让 runner 透传

- 触发：修改 Qwen3-Omni Thinker PP、`capture_layer_indices`/`PP_CAPTURE_PREFIX`、`make_empty_intermediate_tensors`，或 `GPUModelRunner.extract_multimodal_outputs` / `make_omni_output` 对非最终 PP rank 返回值的处理。
- 强制：staged run 且存在 `accept_hidden_layer` 时，捕获层索引为 `[0, accept_layer]`。非最终 PP rank 在返回的 `IntermediateTensors` 中除 `hidden_states`/`residual` 外，必须附带 `capture_{idx}`；接收 rank 对 `idx < start_layer` 的捕获从 intermediate 读取并 `.clone()`，不得复用下一步会被覆盖的 receive buffer。
- 强制：Thinker wrapper 在存在跨 rank 入站捕获时，用 `make_empty_intermediate_tensors_factory(["hidden_states", "residual", *incoming_captures], hidden_size)` 覆盖空张量工厂。runner 必须把 `IntermediateTensors` 当作合法 model output：不得强行 `make_omni_output`；`extract_multimodal_outputs` 透传；
  - profiling/graph dummy 若需要 sampler 行，只取 `hidden_states` 张量字段。
- 验收：PP≥2 覆盖入站捕获 clone、非最终 rank 的 capture key 集合，以及 runner 对 `IntermediateTensors` 的 extract/dummy/make_omni_output 分支；同步与异步 PP 均不得以 `Invalid hidden states type` 启动失败。^[PR #7345]

### [QOMNI-1h3] 混合长度 streaming batch 的 crop 必须用整窗 trim，不得把 padding 当有效未来帧

- 触发：修改 `Qwen3OmniMoeCode2Wav.chunked_decode_streaming` 的 start/end 切片、`seq_token_counts`、left context，或混长 batch 的 decoder trim 计算。
- 强制：decoder 对整批共享同一 right-edge trim。`tail` 必须由 `codes.shape[-1]*total_upsample - batch_wav.shape[-1]` 相对整窗测量，再对每行用 `start = max(0, left_context*up - tail)` 与 `end = max(0, code_seq_len*up - tail)`。padding 不提供有效未来 codec 上下文。
- 验收：独立单请求 oracle 对比混长 batch 的值与长度；覆盖 eager/cudagraph、多种短帧/left-context、batch 顺序，以及 singleton→mixed→singleton 连续流无 skip/repeat。^[PR #7340]

### [QOMNI-1h4] Thinker 中间态捕获必须补上延迟相加的 residual

- 触发：修改 Qwen3-Omni Thinker 的 `capture_layer_indices` / `return_hidden_states`，或把 decoder 层输出交给 Talker。
- 强制：vLLM 把 block 更新和 residual 分开，直到下一次 RMSNorm 才相加。有 residual 时捕获 `hidden_states + residual`；residual 为 `None` 时只 clone `hidden_states`。写入前 view 成 `(-1, hidden)`。捕获不得改变最终 Thinker 输出。
- 验收：单 PP rank 上用会拆开 hidden/residual 的层断言捕获值等于逻辑状态（无 residual 为输入，下一层为 hidden+residual），且开启捕获后的最终输出与不捕获一致。^[PR #7304]

### [QOMNI-1i] thinker→talker 的 accept-hidden 层必须读 config，禁止写死 24

- 触发：修改 `thinker2talker_async_chunk` / `thinker2talker_full_payload`、pooling layer lookup，或 Qwen3-Omni 变体的 `talker_config.accept_hidden_layer`。
- 强制：embedding 固定层 0；accept-hidden 从 transfer manager 的 `_get_model_config()` 或 `config.hf_config.talker_config.accept_hidden_layer` 读取。layer dict 同时接受 int/str key；取 tensor 必须用 `is None`，不能对多元素 tensor 做布尔 `or`。full-payload 用 `hidden_states.layer_{idx}` 拼语义键，而不是写死 `layer_24`。
- 验收：保留 `_get_model_config()` mock 和非 24 accept-hidden 的 full-payload 回归。PR #5825 所示测试未覆盖 adapter `config` fallback；修改该分支时须另补对应 mock，不得宣称现有回归已证明它。缺失层保持 `None` 判定，禁止 tensor truthiness。^[PR #5825]

## 决策与踩坑

- [QOMNI-1a] 禁止：以全局 `enforce_eager` 取代窄 graph boundary；启用更宽的 Q/K norm-RoPE fusion flag；只检查 YAML 文本，或将 Thinker 数值稳定性外推为全部 Qwen stage/平台。
- [QOMNI-1b] 禁止：只映射一个 component wrapper 而给它标记为已映射；让 Thinker/Talker/Code2Wav 各自重复应用 stage mapper；因修复名称匹配而把 BF16 router/encoder 也纳入量化；或把该构造期映射修复描述成 quantization kernel / inference hot path 变化。
- [QOMNI-1c] 禁止：把 Instruct 的 `enable_audio_output` 当作 thinker-only 的充分条件；只修改 YAML 而未注册静态 key；或以 key 存在/原始 YAML 替代最终 resolved pipeline 的断言。
- [QOMNI-1d] 禁止：仅关闭 QKV 或仅修正 `num_local_heads` 而让 output/FFN 仍分片；把这项 fallback 扩大为整个 Qwen3-Omni 模型关闭 TP；或把 PR 的 TP1/2/4/8 手工音频请求、MI350x full-workload throughput 数字归因于该 fallback。
- [QOMNI-1e] 禁止：无参数调用 `_init_token2wav_model()`；恢复 `generate_speech` 或 `_convert_to_codec_tokens`；仅 thread `sampling_metadata` 就声称修复旧 helper（其 Talker `compute_logits` 调用仍带已失效的额外参数）；或让单一 wrapper 违反 staged ownership 而同时拥有 Talker 和 Token2Wav。
- [QOMNI-1f] 禁止：通过 `VLLM_USE_FLASHINFER_MOE_FP16` 或其他 process-wide 环境变量选择 backend；把默认值写成覆盖用户/deploy 显式选择；只改 deploy YAML 却不覆盖 legacy 与 typed builder 的最终 engine args。
- [QOMNI-1g] 禁止：只读 top-level 导致静默回退 `10000`；把 nested 优先写成破坏 TTS top-level 兼容的唯一来源。
- [QOMNI-1h] 禁止：用 `get("moe_backend", "auto") == "auto"` 把显式 `auto` 当成未设置；在 finalize 二次覆盖时丢弃 `_omni_explicit_fields`；只测 helper 不测 legacy+typed builder。
- [QOMNI-1h2] 禁止：非最终 rank 只回传 hidden/residual 而丢掉 Talker 所需捕获；假定 stock vLLM 在非 staged 路径也要 return tuple；或因类型检查失败把 PP 路径改成同步-only workaround 却不修 handoff。
- [QOMNI-1h3] 禁止：按单行 `code_seq_len` 相对整窗波形长度算 per-row tail（短请求会 clamp 到 0 并保留 padding 样本）；只用时长/长度相等证明 crop 正确。
- [QOMNI-1h4] 禁止：只复制 update 张量；把无 residual 的 embedding clone 和有 residual 的层当成同一公式；用捕获开关改变主 forward 数值。
- [QOMNI-1i] 禁止：把 30B 的 `24` 硬编码进共享 processor；用 truthiness 取 tensor；只改 30B 路径却声称任意 `accept_hidden_layer` 已兼容。
