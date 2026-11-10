---
name: qwen-omni-overview
description: Qwen-Omni 家族（Qwen2.5-Omni / Qwen3-Omni / Qwen3-TTS）目录入口（main @ 94b1546c）：别名与 pipeline registry key（含 qwen3_omni_moe resolver 与静态 thinker-only）、deploy YAML 清单、NVFP4 / MUSA FP8 / AWQ 名称映射 / MoE backend 默认值 / vLLM 0.27 registry 重名 / Token2Wav soft-fail 的边界速览，以及各 QOMNI 规则页的路由表
metadata:
  scope: 只收 Qwen-Omni 家族的别名、registry、deploy 清单、各边界的一句话速览与规则页路由；拓扑与性能结论归 qwen-omni-architecture，QOMNI-1a 至 1i 归 qwen-omni-rules，QOMNI-2a 归 rules-realtime，QOMNI-INPUT 归 rules-thinker-input，QOMNI-MRV2 归 qwen-omni-rules-mrv2-audio，QOMNI-EMBED-1a 归 rules-embedding-capture，QOMNI-TOKEN2WAV-BLOCK-1a 归 rules-token2wav-attention
---
# Qwen-Omni 家族（Qwen2.5-Omni / Qwen3-Omni / Qwen3-TTS）

## 现状

- 常见别名：`qwen2_5_omni`、`qwen3_omni_moe`、`qwen3_omni_moe_thinker_only`、`qwen3_tts`（家族目录：同一 thinker/talker/code2wav 谱系的多个 checkpoint/代际，按别名规则共用本目录）
- 源码模型族（`main @ 94b1546c` 验证）：`model_executor/models/qwen2_5_omni/`、`qwen3_omni/`、`qwen3_tts/`；
  - pipeline registry key `qwen2_5_omni`、`qwen2_5_omni_thinker_only`、`qwen3_omni_moe`（resolver `resolve_qwen3_omni_pipeline`，位于 `models/qwen3_omni/pipeline.py`，由 `pipeline_registry.py:86/:100` 引用）、`qwen3_omni_moe_thinker_only`（静态单 stage `PipelineConfig`，绕过 resolver）、`qwen3_tts`
- deploy YAML：`qwen2_5_omni.yaml`（1×H100 验证）、`qwen3_omni_moe.yaml`（2×H100 验证）、`qwen3_omni_moe_mori_intranode.yaml`、`qwen3_omni_moe_thinking.yaml`（显式 thinker-only 覆盖）与 `qwen3_tts.yaml`（+ `_forced_aligner`、`_high_concurrency` 变体）
- Qwen2.5 thinker-only 的 ModelOpt NVFP4 W4A4 checkpoint 支持、stage sub-config、Talker ingress/internal width 与硬件/accuracy 证据边界归下方 architecture 入口。
- Qwen3-Omni 的 MUSA ModelOpt FP8 边界是 Thinker 保留量化、Talker/Code2Wav 通过 deploy overlay 显式清除 root quantization metadata，并仅关闭不安全的 Talker-MTP FULL graph wrapper；精确三态与验证边界归下方 architecture 入口。
- Qwen3-Omni 的 AWQ/compressed-tensors checkpoint 名称必须在统一 wrapper 映射一次；嵌套 Thinker/Talker/Code2Wav 不得再次改名，仅在自身声明 packed modules 时补充对应 metadata。component/default quant configs 都是同一映射合同的一部分；验收规则归本目录的 Qwen-Omni rules。^[PR #5687]
- Qwen3-Omni 的 MoE backend 默认仅在已解析值仍为 `auto`/缺失时选择 `triton`，显式 backend 保留；随仓库发布的 2×H100 profile 为 Thinker 与 Talker 都 pin `moe_backend: triton`，不再以 `VLLM_USE_FLASHINFER_MOE_FP16` 这类环境变量选择。legacy/typed builder 的最终 args 都是验收边界；精确规则与证据限制见本目录 Qwen-Omni rules。^[PR #7019]
- vLLM 0.27 后 upstream 与 Omni registry 有同名 architecture：Omni 必须覆盖全局 entry；plain `vllm serve` 缺 `model_stage` 时 Qwen2.5/Qwen3 默认 thinker，Qwen3 thinker 在非 staged 模式返回 bare tensor，只有 staged talker consumer 才请求 captured layers；
  - 共享验收见 [[rules-bridge-batch-1]]（EXEC-1e；源锚点 #exec-1e-upstream-registry-重名时-omni-override-与-plain-vllm-forward-必须同时成立）。^[PR #5976]
- Qwen2.5 的 code2wav/Token2Wav 缺失、speaker resource loading 或旧 direct speech helper 问题，必须按 staged Thinker → Talker → Code2Wav ownership 处理；soft-fail、有效 HF-folder initializer caller 与已删除 helper 的边界见本目录 Qwen-Omni rules。^[PR #6886]
- 官方历史文档：`docs/design/module/archive/async_omni_architecture.md`（以 Qwen3-Omni 为 worked example 的分层运行时快照，非 active spec）、`docs/design/qwen3_omni_tts_performance_optimization.md`（性能优化实录）

### 什么时候查这里

- 问题只属于 Qwen-Omni/TTS 家族（thinker/talker 拓扑、talker_mtp、code2wav、TTS 性能口径）。

### 不放什么

- 共享 runner/预处理合同（放 components/model-executor）；共享调度与 prefix cache（放 components/scheduler）。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| stage 拓扑、代际差异与官方性能优化结论 | [[qwen-omni-architecture]]（architecture） |
| 仍保留旧 Qwen 专属 Realtime 的 token/ms 近似对齐，或区分当前 generic duration-based truncate | [[rules-realtime]]（Realtime 音频 history 规则） — QOMNI-2a。 |
| Qwen3-Omni Thinker MRoPE、CUDA compilation custom-op boundary、AWQ/compressed-tensors 名称映射、MoE backend default/override、固定种子音频回归、audio-encoder head/TP divisibility、Qwen2.5 code2wav soft-fail/旧 speech helper，或 code predictor 的 RoPE theta/rope_parameters 读取
| [[qwen-omni-rules]]（Qwen-Omni rules） — QOMNI-1h、QOMNI-1h2、QOMNI-1h3、QOMNI-1h4；QOMNI-1i 核对 thinker→talker 配置选层与测试覆盖边界。 |

- （以下为原表格，按行改写为条目）
- 遇到什么：Thinker audio resampler 或 deepstack meta-device buffer
  - 查看哪里：[[rules-thinker-input]]（Thinker 输入与 buffer 规则）
- [[qwen-omni-rules-mrv2-audio]]（MRv2 sampled handoff、first audio 与 decoder opt-in）
- [[rules-embedding-capture]]（Qwen3-Omni layer-0 embedding capture 合同）。
- [[rules-token2wav-attention]]（Qwen2.5-Omni Token2Wav block attention 合同）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen-omni/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, qwen-omni；created: 2026-07-16；updated: 2026-10-09
- 来源（sources）：PR #5073；PR #5671；PR #5687；PR #5976；PR #6284；PR #4322；PR #6886；PR #7019；vllm_omni/model_executor/models/qwen2_5_omni/qwen2_5_omni.py；vllm_omni/model_executor/models/qwen2_5_omni/qwen2_5_omni_thinker.py；vllm_omni/model_executor/models/qwen3_omni/quantization.py
  - vllm_omni/model_executor/models/qwen3_omni/qwen3_omni_moe_thinker.py；vllm_omni/model_executor/models/registry.py；vllm_omni/model_executor/models/qwen2_5_omni/pipeline.py；vllm_omni/model_executor/models/qwen3_omni/pipeline.py；vllm_omni/model_executor/models/qwen3_omni/qwen3_omni.py
  - vllm_omni/config/pipeline_registry.py；vllm_omni/deploy/qwen3_omni_moe.yaml；vllm_omni/deploy/qwen3_omni_moe_thinking.yaml；vllm_omni/engine/stage_init_utils.py；vllm_omni/quantization/component_config.py；tests/engine/test_stage_engine_args.py
  - docs/design/qwen3_omni_tts_performance_optimization.md
