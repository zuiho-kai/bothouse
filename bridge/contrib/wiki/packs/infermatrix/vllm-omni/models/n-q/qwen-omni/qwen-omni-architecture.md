---
name: qwen-omni-architecture
description: "Qwen-Omni 家族拓扑与性能结论（main @ 94b1546c）：Qwen3-Omni 三 stage / Qwen3-TTS 两 stage / Qwen2.5-Omni 与 thinker-only、resolver 与静态 qwen3_omni_moe_thinker_only、Qwen2.5 ModelOpt NVFP4 W4A4 边界（PR #5073）、Qwen3-Omni MUSA ModelOpt FP8 边界（PR #5671）、官方 batching / CUDA Graph / async chunk 的 E2E 与 TTFP 数字"
metadata:
  scope: 只收 Qwen-Omni 家族的 stage 拓扑、量化边界证据、官方性能结论与运行时参照；别名、registry 与 deploy 清单归 qwen-omni-overview，可执行门禁归 qwen-omni-rules
---
# Qwen-Omni 家族拓扑与性能结论

## 现状

- 以下事实在 `main @ 94b1546c` 复核。

### Stage 拓扑

- **Qwen3-Omni**（原生多模态理解 + 语音生成）三 stage：**Thinker**（多模态理解 + 文本生成）→ **Talker**（含 Talker-MTP / code predictor 路径，把语义/文本表征转 codec token）→ **Code2Wav**（codec token 解码为波形）。
- **Qwen3-TTS**（轻量 TTS）两 stage：**Talker（AR decoder）**→ **Code2Wav（vocoder）**。
- **Qwen2.5-Omni**：registry 注册 Thinker/Talker/Token2Wav（含 DiT 变体）架构名；`qwen2_5_omni_thinker_only` pipeline 提供纯理解形态——hunyuan 架构页把 `qwen2_5_omni_thinker.py` 标为 **I2T blessed pattern**（新模型 I2T 适配的照抄基准）。
- Qwen2.5-Omni 同样按 stage 分别构造：Thinker 产出文本 hidden states，Talker 产出 codec token，Code2Wav 独占 Token2Wav 并将 codec 解码成波形。
  - PR #6886 因此删除未被 staged pipeline 使用的 `generate_speech` 及其私有 converter，而非只补 sampling metadata：后者仍会以额外参数调用仅接受 `hidden_states` 的 Talker `compute_logits`，且没有已构造 instance 同时拥有 Talker 与 Token2Wav。Code2Wav 缺 Token2Wav 时 `_codec_to_audio` 返回 `None`；
  - speaker resource initializer 只由有 HF folder 的 weight-loading path 调用。该 deletion-only PR 没有新增测试、E2E、质量或性能证据。^[PR #6886]
- Qwen3-Omni 的 pipeline 由 resolver（`models/qwen3_omni/pipeline.py:: resolve_qwen3_omni_pipeline`）按 checkpoint 结构动态决定，而不是冻结的 `PipelineConfig` 字面量。
- `qwen3_omni_moe_thinker_only` 是例外：它直接注册冻结的单 Thinker、text→text `PipelineConfig`。`qwen3_omni_moe_thinking.yaml` 显式指定该 key，所以 Instruct checkpoint 即使由 HF `enable_audio_output` 判为全三 stage，也会加载 Thinker 而不加载 Talker/Code2Wav；Captioner/Thinking checkpoint 不带该 YAML 时仍由 resolver 自动选同一单 stage 拓扑。
  - 该变更只证明配置解析和拓扑选择，未提供质量、吞吐、显存或端到端 serve 证据。^[PR #6284]

### Qwen2.5-Omni ModelOpt NVFP4 边界

- `qwen2_5_omni` full pipeline 和 `qwen2_5_omni_thinker_only` 的 Thinker 都显式用 `thinker_config`；full Talker 用 `talker_config`，Code2Wav 用 `thinker_config`。同一个 `hf_config_name` 同时选择 stage text config、architecture/quantization view 与 input width。
- thinker-only ModelOpt NVFP4 W4A4 不增加 kernel 或 Qwen2.5 专用 resolver：checkpoint root 的 `quantization_config` 进入 vLLM 既有 `ModelOptNvFp4Config`，ignore/exclude 保持 audio/visual encoder、embedding、LM head、Talker、Token2Wav/Code2Wav 和 KV cache 为 BF16；
  - 只有 Thinker language-backbone linear 命中现有 FlashInfer Cutlass NVFP4 kernel。支持声明因此绑定 ModelOpt checkpoint metadata 与排除规则，不能泛化成所有 Qwen2.5 stage 或任意 FP4 checkpoint。
- Qwen2.5 Talker 的外部 3584 width 在 forward 内投影到内部 896；shared runner 的 buffer 必须按 `get_inputs_embeds_size()` 分配。Qwen3 在 preprocessing 已投影，未 override 时仍回退 internal hidden size。共享门禁见 [[rules-bridge-batch-1]]（EXEC-1d；源锚点 #exec-1d-cross-stage-embedding-buffer-必须按-ingress-width-分配）。
- 最终 head 的外部验证只覆盖单张 RTX PRO 6000 Blackwell、TP1、特定 vLLM/PyTorch/Transformers/FlashInfer 栈：full three-stage server 启动、仅 Thinker 选 NVFP4 kernel，以及 deterministic text smoke。accuracy/perf 也是同一硬件上的 text-output workload，且相对 BF16 accuracy 分别下降 1.17 与 3.5 percentage points；这些是 case-bound 取舍，不是质量或加速保证。
  - 更早的表来自旧 commit backport/旧依赖，不能当最终 head 证据。最终 diff 也缺 Qwen2.5 ingress≠internal 的直接 unit test。^[PR #5073]

### Qwen3-Omni 在 MUSA 上的 ModelOpt FP8 边界

- MUSA deploy profile 只在 stage 1 Talker 与 stage 2 Code2Wav 合并 `hf_overrides.quantization_config: null`，显式清除 checkpoint root 的 ModelOpt metadata；stage 0 Thinker 保留 ModelOpt FP8，非 MUSA base profile 不变。该语义位于 deploy overlay，没有扩张通用 arg/config resolver；
  - 合并门禁见 [[configuration-rules-3]]（CONF-3a；源锚点 #conf-3a-争议以展开后的最终配置为准）。
- Qwen3 wrapper 只在 `model_stage == "talker"` 时从当前平台写入 `talker_mtp_graph_safe`。共享 runner 保留 tri-state：未声明时仅沿用 separate-talker legacy 行为，false 阻止 dedicated Talker-MTP FULL graph wrapper，true 才允许；buffer 初始化及其他 compile/capture 路径不受影响。
  - MUSA false 的具体原因是 `torch.multinomial` 在 stream capture 中报不允许该操作，而非整个 Qwen stage 必须 eager；共享门禁见 [[model-executor-rules-2]]（EXEC-4c；源锚点 #exec-4c-talker-mtp-graph-能力必须保留-tri-state-语义）。
- PR 最终 diff 没有 code-predictor `forward_musa` override：review 确认当前 `CustomOp` MUSA dispatch 已委托 `forward_cuda`，cached RoPE `_lookup` 可复用。旧 v0.24.1 集成里的 on-the-fly native matmul workaround 不属于当前实现，不能按 PR 初版描述复活。
- 外部证据仅是一套 2×MTT S5000、MUSA 5.2 compatibility image 上的单次 text+audio smoke：HTTP 200、有限音频值且日志无 stage/engine failure。环境含外部兼容改动，image digest 仅记录截断值，也没有 BF16 baseline、质量或性能对比，因此只能支持可运行性，不能泛化为精度/吞吐结论。^[PR #5671]

### 官方性能优化结论（docs/design/qwen3_omni_tts_performance_optimization.md）

- 两模型共享同一多 stage 设计，叠加同一组优化：**batching**（逐 stage 提升 GPU 利用率）、**CUDA Graph**（降低 CPU launch 开销与 decode 抖动）、**async chunk + 流式输出**（跨 stage 重叠计算与通信、增量出音频，同时改善 TTFP 与 E2E）。对 HF Transformers（离线单请求）的实测（Qwen3-Omni @A100）：E2E 336.10s → 23.78s（~93%↓）、TTFP 336.10s → 0.934s（~99.7%↓）、RTF 3.776 → 0.32（~12×）。
  - （Qwen3-TTS @H200 的并发曲线见原文；数字随版本漂移，引用前复核。）

### 运行时参照

- 家族曾以 `docs/design/module/archive/async_omni_architecture.md` 的分层运行时（API → Engine → Orchestration → Communication → Execution）的官方 worked example；该页现为历史快照，active draft source map 是 `module/engine_orchestration.md` 与 `module/stage_runtime.md`，所以 worked example 必须对当前源码复核；
  - 相关共享机制：talker 的 prefix-cache 关键 key 合同见 [[scheduler-rules-1]]、[[scheduler-rules-2]]（Scheduler 规则 SCHED-1a），`talker_mtp` 路由与 runner 预处理合同见 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（Model Executor）。

### 已有证据索引（只链接）

- CI 事故（qwen3_omni prefix caching 用例等）见 [[ci-incidents-overview]]（ci incidents）。
- 小 token 预算挂 GPU 的案例（`test_qwen3_omni_expansion.py`）见 [[scheduler-rules-1]]、[[scheduler-rules-2]]（Scheduler 规则 SCHED-2a）。
- 源码会变化，具体类名和行号在改代码前必须以目标仓库当前版本为准。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen-omni/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, qwen-omni；created: 2026-07-16；updated: 2026-09-04
- 来源（sources）：PR #5073；PR #5671；PR #6284；PR #6886；docs/design/qwen3_omni_tts_performance_optimization.md；docs/design/module/engine_orchestration.md；docs/design/module/stage_runtime.md；docs/design/module/archive/async_omni_architecture.md；vllm_omni/config/model.py
  - vllm_omni/config/pipeline_registry.py；vllm_omni/deploy/qwen3_omni_moe.yaml；vllm_omni/deploy/qwen3_omni_moe_thinking.yaml；vllm_omni/model_executor/models/common/qwen3_code_predictor.py；vllm_omni/model_executor/models/qwen2_5_omni/pipeline.py
  - vllm_omni/model_executor/models/qwen2_5_omni/qwen2_5_omni.py；vllm_omni/model_executor/models/qwen3_omni/pipeline.py；vllm_omni/model_executor/models/qwen3_omni/qwen3_omni.py；vllm_omni/model_executor/models/registry.py；vllm_omni/platforms/interface.py
  - vllm_omni/platforms/musa/platform.py；vllm_omni/worker/gpu_ar_model_runner.py；vllm_omni/worker/gpu_model_runner.py
