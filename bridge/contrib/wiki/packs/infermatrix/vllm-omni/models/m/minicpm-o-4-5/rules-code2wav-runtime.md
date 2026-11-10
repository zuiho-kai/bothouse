---
name: rules-code2wav-runtime
description: "MiniCPM-o 4.5 Code2Wav 运行时合同：MCPMO-1f Ascend NPUGraph 只捕获精确形状的 CFM DiT（PR #5604）、MCPMO-1g 移除 Token2Wav 的 eager TorchDynamo 包装（PR #6274）、MCPMO-1h 编码窗口受 RelPos 与缓存预算约束（PR #6346）、MCPMO-1i 解包兼容无 encoder 的 Flow（PR #6397）"
metadata:
  scope: 只收 MCPMO-1f/1g/1h/1i；CUDA 上的 HiFT 与 CFM graph 规则归 rules-cuda-graphs，并发批处理归 rules-code2wav-batching，Code2Wav TensorRT 归 minicpm-o-4-5-rules-1
---
# MiniCPM-o 4.5 Code2Wav 运行时合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules-code2wav-runtime.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-07-20；updated: 2026-09-07
- 来源（sources）：PR #3642；PR #5165；PR #5382；PR #5524；PR #5638；PR #5792；PR #5869；PR #6056；PR #6154；PR #6170；PR #6318；PR #6828；tests/dfx/perf/tests/test_minicpmo_4_5.json；tests/dfx/perf/tests/test_minicpmo_4_5_duplex_seed_tts.json；tests/e2e/accuracy/minicpmo_4_5/test_minicpmo_4_5.py
  - tests/e2e/online_serving/helpers/minicpmo_4_5_duplex.py；tests/e2e/online_serving/test_minicpmo_realtime_duplex_drivers.py；tests/e2e/online_serving/test_minicpmo_4_5.py；tests/e2e/online_serving/test_minicpmo_4_5_duplex.py；tests/e2e/online_serving/test_minicpmo_4_5_expansion.py
  - tests/e2e/online_serving/run_minicpmo_realtime_duplex_soft_interrupt.py；vllm_omni/benchmarks/data_modules/seed_tts_dataset.py；vllm_omni/benchmarks/data_modules/seed_tts_eval.py；vllm_omni/benchmarks/patch/patch.py；vllm_omni/deploy/minicpmo_4_5.yaml
  - vllm_omni/experimental/fullduplex/client.py；vllm_omni/entrypoints/duplex/chat_fallback.py；vllm_omni/entrypoints/duplex/realtime_input.py；vllm_omni/entrypoints/duplex/session_runner.py；vllm_omni/entrypoints/duplex/serving.py；vllm_omni/entrypoints/duplex/vad.py
  - vllm_omni/model_executor/models/minicpmo_4_5/duplex/adapter.py；vllm_omni/model_executor/models/cosyvoice3/code2wav_core/hifigan.py；vllm_omni/model_executor/models/minicpmo_4_5/batched_token2wav.py；vllm_omni/model_executor/models/minicpmo_4_5/cuda_graph_wrapper.py
  - vllm_omni/model_executor/models/minicpmo_4_5/minicpmo_4_5_code2wav.py；vllm_omni/model_executor/models/minicpmo_4_5/minicpmo_4_5_omni_llm.py；vllm_omni/model_executor/models/minicpmo_4_5/minicpmo_4_5_omni_tts.py；vllm_omni/model_executor/stage_input_processors/minicpmo_4_5_omni.py
  - tests/model_executor/models/minicpmo_4_5/test_audio_chunk_mask.py；tests/model_executor/models/minicpmo_4_5/test_cfm_graph_capture_gating.py；tests/model_executor/models/minicpmo_4_5/test_code2wav_batching.py；tests/model_executor/models/minicpmo_4_5/test_cuda_graph_wrapper.py
  - tests/model_executor/models/minicpmo_4_5/test_pipeline.py；tests/model_executor/models/minicpmo_4_5/test_talker_batching.py；tests/model_executor/models/minicpmo_4_5/test_vision_flash_attention.py；PR #6082；PR #5604；PR #6274；PR #6346；PR #6397；PR #6406；PR #6458；PR #6587；PR #6619
  - PR #6757；PR #6529；PR #6772；vllm_omni/entrypoints/duplex/protocol.py
- 置信度（confidence）：high
- 入口与其他规则见 [[minicpm-o-4-5-rules-1]]、[[minicpm-o-4-5-rules-2]]、[[minicpm-o-4-5-rules-3]]（共享规则）。
- [MCPMO-1f] Ascend Code2Wav NPUGraph 只捕获精确形状的 CFM DiT
  - 触发：MiniCPM-o 4.5 在 Ascend 上修改 Code2Wav、CFM DiT estimator、NPUGraph 开关、图缓存或 bundled deploy profile。
  - 强制：Stage 2 保持 outer `enforce_eager: true`，只将确定性的 `blocks_forward_chunk` 放入按 exact shape 捕获的 inner NPUGraph；`t_embedder`、flow encoder、HiFT/RNG、请求解析和 request-owned state commit 必须 eager。cached 与 uncached attention/CNN state 使用独立 graph bucket，`code2wav_max_npu_graphs` 默认 32，超过上限的新 shape 回 eager；
    - `code2wav_enable_npu_graph: false` 必须能关闭该 inner graph。Token2Wav 加载前设置 `torch.npu.config.allow_internal_format = False`、`torch.npu.set_compile_mode(jit_compile=False)`，拒绝 `ASCEND_LAUNCH_BLOCKING=1`，并在 graph mode 要求 MATH SDPA。
  - 验收：解析 `minicpmo_4_5.yaml`、`minicpmo_4_5_2gpu.yaml` 和 `minicpmo_4_5_3gpu.yaml` 的 NPU 最终 stage config，断言 Stage 0/1 的 `PIECEWISE`、Stage 2 的 outer eager 与 additional config；CPU 测试覆盖 timestep、exact dispatch、cache bucket、clone ownership、runtime precondition、MATH 选择和 fail-stop；
    - A3 测试覆盖 uncached/cached eager parity。任何性能声明还必须记录 exact command、A3 硬件/驱动/torch-npu、warmup、测量轮数、并发、延迟/RTF 和峰值 NPU memory。^[PR #5604]
- [MCPMO-1g] Token2Wav 的 eager TorchDynamo 包装必须在流式热路径中移除
  - 触发：MiniCPM-o 4.5 的 Token2Wav/CosyVoice 流式路径使用 `torch.compile(backend="eager")` 包装 `forward_chunk`，并在新 chunk shape 上出现首响应停顿。
  - 强制：在 `BatchedToken2Wav` 初始化时，仅当方法存在 `_torchdynamo_orig_callable` 或 `__wrapped__` 时恢复原始 bound method；保留 estimator、encoder、HiFT 的其他路径及其运行时语义。
  - 验收：检查存在包装时初始化后 `forward_chunk` 已指向原始实现、无包装时保持不变；用 cold 与 warm 的多 chunk duplex 回归确认首个响应不再长时间停顿、后续响应持续产出音频，且 steady-state 行为未被改变。 ^[PR #6274]
- [MCPMO-1h] Code2Wav 编码窗口必须受 RelPos 与缓存预算约束
  - 触发：修改 MiniCPM-o Code2Wav 的长 codec prefill、`forward_chunk`、RelPos PE、upsample 或 conformer cache。
  - 强制：按 PE `max_pos`、upsample stride、cache offset 和 lookahead 计算安全 token 窗口，限制单片上限并切分超长输入；非最终片保留 lookahead，调用 `forward_chunk` 前确保 PE 足够，按 batch 行合并音频并延续 cache。
  - 验收：单测覆盖预算计算与切片计划，fake Code2Wav 测试断言每片大小、`last_chunk` 和非空音频；不得从该修复推断通用性能提升。 ^[PR #6346]
- [MCPMO-1i] Code2Wav dynamo 解包必须兼容无 encoder 的 Flow
  - 触发：MiniCPM-o 4.5 `BatchedToken2Wav` 初始化需要对 `flow.encoder.forward_chunk` 执行 TorchDynamo 解包，但某些 decoder/estimator-only Flow 没有 `encoder`。
  - 强制：先以 `getattr(self.flow, "encoder", None)` 检查 encoder；仅在 encoder 存在时解包 `forward_chunk`，真实 CosyVoice flow 仍必须保留原有解包行为。
  - 验收：decoder/estimator-only `_Flow` 能成功构造并完成 NPU graph/eager 回归；带 encoder 的 CUDA MiniCPM-o 4.5 路径仍确认 `forward_chunk` 的 Dynamo 包装被正确移除。 ^[PR #6397]

## 决策与踩坑

- [MCPMO-1f] 禁止：捕获整个 Code2Wav Stage 2 或依赖全局 `--enforce-eager` 代替 stage-scoped 配置；把 graph 开关放进 shared connector extra；让失败捕获继续复用可能已损坏的 allocator/RNG state；把 NPU graph 的 parity、缓存或性能结论外推到 HiFT、TRT、CUDA 或其他模型。
- [MCPMO-1g] 禁止：让 eager backend 的 tracing/guard 构造进入每个未见 chunk shape 的实时响应；把该解包扩大为所有后端、模型或 CUDA Graph 路径的通用优化。
- [MCPMO-1h] 禁止：把数千 codec token 一次送入固定 RelPos PE；忽略 cache offset 或把非最终短片静默截断；用空音频掩盖窗口溢出。
- [MCPMO-1i] 禁止：无条件访问 `self.flow.encoder`，或让 encoder-less 的 NPU Code2Wav 图测试与其他合法 Flow 在构造阶段因 `AttributeError` 失败。
