---
name: minimax-h3-rules-1
description: MiniMax H3 规则（上）：只有 MMH3-数字字母 是规则 ID，Direct 代码快速入口（PR 描述信号→MMH3 规则与 loading/media/cache-task/deployment/VAE ops 页）与完整代码路由表（MMH3-1a 至 MMH3-4c 的信号、规则页锚点和第一批源码）
metadata:
  scope: 只收规则 ID 说明和两张路由表；MMH3-1b、1c、1e、1g 归 minimax-h3-rules-2，MMH3-1h、1i、1k、1j、1m、4a、4b 归 minimax-h3-rules-3
---
# MiniMax H3 规则（1/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/3 部分；第 2 部分 [[minimax-h3-rules-2]]；第 3 部分 [[minimax-h3-rules-3]]
- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-02；updated: 2026-09-09
- 来源（sources）：PR #5703；PR #5706；PR #5720；PR #5737；PR #5764；PR #5779；PR #5801；PR #5824；PR #5829；PR #5836；PR #5837；PR #5840；PR #5853；PR #5881；PR #5891；PR #5896；PR #5991；PR #5997；PR #6000；PR #6040；PR #6724；benchmarks/diffusion/backends.py；benchmarks/diffusion/diffusion_benchmark_serving.py
  - docs/design/feature/skip_softmax.md；docs/user_guide/diffusion/attention_backends.md；docs/user_guide/diffusion/attention_backends/trtllm.md；vllm_omni/config/model.py；vllm_omni/config/omni_config.py；vllm_omni/diffusion/attention/backends/rainfusion_attn.py
  - vllm_omni/diffusion/attention/backends/trtllm_attn.py；vllm_omni/diffusion/cache/cachedit/backend.py；vllm_omni/diffusion/cache/cachedit/runtime.py；vllm_omni/diffusion/cache/teacache/；vllm_omni/diffusion/forward_context.py；vllm_omni/diffusion/layers/norm.py
  - vllm_omni/diffusion/layers/rope.py；vllm_omni/diffusion/model_metadata.py；vllm_omni/diffusion/models/minimax_h3/encoder.py；vllm_omni/diffusion/models/minimax_h3/lora.py；vllm_omni/diffusion/models/minimax_h3/minimax_h3_transformer.py
  - vllm_omni/diffusion/models/minimax_h3/pipeline_minimax_h3.py；vllm_omni/diffusion/models/minimax_h3/quality_policy.py；vllm_omni/diffusion/models/minimax_h3/time_request.py；vllm_omni/diffusion/models/minimax_h3/vae.py；vllm_omni/diffusion/offloader/module_residency.py
  - vllm_omni/diffusion/sched/sigma_schedule.py；vllm_omni/diffusion/utils/hf_utils.py；vllm_omni/entrypoints/omni_base.py；vllm_omni/quantization/int8_config.py；tests/dfx/perf/scripts/run_diffusion_benchmark.py；tests/dfx/perf/tests/test_minimax_h3_vllm_omni.json
  - tests/diffusion/attention/test_rainfusion_plan.py；tests/diffusion/attention/test_trtllm_attn.py；tests/diffusion/cache/test_cache_backends.py；tests/diffusion/cache/test_cache_dit_request_runtime.py；tests/diffusion/cache/test_teacache_extractors.py；tests/diffusion/layers/test_norm.py
  - tests/diffusion/layers/test_rope_broadcast.py；tests/diffusion/models/minimax_h3/test_minimax_h3_contract.py；tests/diffusion/models/minimax_h3/test_minimax_h3_dlo_lifecycle.py；tests/diffusion/models/minimax_h3/test_minimax_h3_lora.py
  - tests/diffusion/models/minimax_h3/test_minimax_h3_parallel.py；tests/diffusion/models/minimax_h3/test_minimax_h3_quality_policy.py；tests/diffusion/models/minimax_h3/test_minimax_h3_quantization.py；tests/diffusion/models/minimax_h3/test_minimax_h3_quantization_quality.py
  - tests/diffusion/offloader/test_module_residency.py；tests/diffusion/quantization/test_int8_config.py；recipes/MiniMaxAI/MiniMax-H3.md；recipes/MiniMaxAI/MiniMax-H3-5090.md；recipes/MiniMaxAI/MiniMax-H3-MUSA.md；recipes/MiniMaxAI/MiniMax-H3-NPU.md
  - vllm_omni/diffusion/worker/diffusion_model_runner.py；vllm_omni/engine/async_omni_engine.py；PR #5915；PR #5990；vllm_omni/diffusion/layers/fused_qk_norm_rope.py；vllm_omni/diffusion/cache/teacache/extractors.py；tests/diffusion/layers/test_fused_qk_norm_rope.py；PR #6061
- 置信度（confidence）：high
- 只有 `MMH3-数字字母` 是可审计规则 ID。

### Direct 代码快速入口

| PR 描述信号 | 规则入口 |
|---|---|
| component quantization、weight loading、HWR | `MMH3-1a`、`MMH3-1f`；[[rules-loading]]（loading） |
| attention/RoPE/backend、encoder process state | `MMH3-1c`–`MMH3-1e`、`MMH3-1g`、`MMH3-1k`、`MMH3-1n` |
| media ingress、reference tasks、split text encoder、text-conditioning schema | `MMH3-2a`、`MMH3-2b`、`MMH3-2l`、`MMH3-2q`；[[rules-media-1]]、[[rules-media-2]]（media） |
| modular task、cache policy、schedules、LoRA/FastH3、alias metadata、Turbo artifact | `MMH3-2c`–`MMH3-2p`；[[rules-cache-task-1]]、[[rules-cache-task-2]]、[[rules-cache-task-3]]（cache/task） |

- （以下为原表格，按行改写为条目）
- PR 描述信号：DLO、hardware recipes、CI/perf evidence
  - 规则入口：`MMH3-3a`–`MMH3-3m`；[[rules-deployment-1]]、[[rules-deployment-2]]（deployment）
- PR 描述信号：VAE kernels、materialization、keyframe encode determinism、fallback
  - 规则入口：`MMH3-4c`、`MMH3-4d`；[[rules-vae-ops]]（VAE ops）
- PR 描述信号：NPU text-MLP packed SwiGLU、quant dispatch、DiT activation
  - 规则入口：`MMH3-4a`、`MMH3-4b`

### 完整代码路由

- （以下为原表格，按行改写为条目）
- PR 描述信号：online FP8、`ignored_layers`、component prefix
  - 规则：[[rules-loading]]（MMH3-1a；源锚点 #mmh3-1a-component-namespace-与-checkpoint-transform-必须在-active-loader-前闭合）
  - 第一批源码：`pipeline_minimax_h3.py::_resolve_component_quant_config` → `MiniMaxH3DiTModel` linear prefix
- PR 描述信号：grouped QKV、fused MLP、weight loader、TP
  - 规则：[[rules-loading]]（MMH3-1a；源锚点 #mmh3-1a-component-namespace-与-checkpoint-transform-必须在-active-loader-前闭合）
  - 第一批源码：`minimax_h3_transformer.py::MiniMaxH3DiTModel.load_weights` → active vLLM loader
- PR 描述信号：FP8 quality、audio metric、layerwise offload
  - 规则：`MMH3-1b`
  - 第一批源码：quantization quality test → recipe/support matrix → nightly lane
- PR 描述信号：RMSNorm、RoPE、96/128 rotary dim、fused backend
  - 规则：`MMH3-1c`
  - 第一批源码：`MiniMaxH3Attention` → shared `RMSNorm`/`RotaryEmbedding` → platform dispatch
- PR 描述信号：RainFusion/NPU INT8；decoded video BCTHW→BTHWC uint8
  - 规则：`MMH3-1d`, [[rules-media-1]]（MMH3-1o；源锚点 #mmh3-1o-h3-decoded-video-必须在-transfer-前定型为-contiguous-uint8）
  - 第一批源码：attention plan；H3 output prepare/postprocess → video uint8 consumer
- PR 描述信号：TRTLLM、ragged packed metadata、SAGE、Skip-Softmax、Blackwell default
  - 规则：`MMH3-1e`
  - 第一批源码：H3 metadata/roles → TRTLLM packed trim/quant gate → platform default
- PR 描述信号：text encoder、missing q/k/v 或 gate/up、eager load bookkeeping
  - 规则：[[rules-loading]]（MMH3-1f；源锚点 #mmh3-1f-text-encoder-eager-load-必须证明每个-source-shard-完整）
  - 第一批源码：`encoder.py::_load_weights` → `pipeline_minimax_h3.py::load_weights` strict report
- PR 描述信号：NPU packed varlen、quadratic mask、LaserAttention、prefix K/V
  - 规则：`MMH3-1g`
  - 第一批源码：H3 packed producer → backend capability/metadata → NPU FlashAttention fallback
- PR 描述信号：Qwen3-VL encoder、NPU causal GQA、AddRMSNorm residual
  - 规则：`MMH3-1k`
  - 第一批源码：encoder SDPA helper/residual call → NPU model patch → `torch_npu` op
- PR 描述信号：Qwen3-VL encoder、cuDNN SDPA、process-global backend state、encoder TP
  - 规则：[[rules-encoder-state]]（MMH3-1n；源锚点 #mmh3-1n-qwen3-vl-encoder-的-cudnn-sdpa-override-必须恢复原状态）
  - 第一批源码：`encode_ids` state capture/restore → encoder-rank call → VAE boundary
- PR 描述信号：VAE decoder、Triton exact ops、FP16 materialization、SM90/100/103、compile/SP fallback
  - 规则：[[rules-vae-ops]]（MMH3-4c；源锚点 #mmh3-4c-h3-vae-eager-ops-必须以完整远程模型合同和-reference-fallback-安装）
  - 第一批源码：`vae.py::MiniMaxH3VideoVAE.__init__` → `ops/vae::{dispatch,install}` → target tests
- PR 描述信号：FL2VA keyframe、Ref2VA mixed reference/时域限界、shape/output matrix
  - 规则：[[rules-media-1]]（MMH3-2a；源锚点 #mmh3-2a-taskreferenceshape-与多输出必须作为一个输入矩阵维护）
  - 第一批源码：`pipeline_minimax_h3.py` → `reference_video.py`
- PR 描述信号：media limit、typed/multipart reference、HTTP 400、temp source
  - 规则：[[rules-media-1]]（MMH3-2b；源锚点 #mmh3-2b-media-ingress-在解码前限界request-错误保持-http-400）
  - 第一批源码：`api_server.py` → `serving_video.py` → `reference_video.py`
- PR 描述信号：split text encoder、H3 presentation/tag、conditioning bridge、prepared artifact
  - 规则：[[rules-media-2]]（MMH3-2l；源锚点 #mmh3-2l-split-text-encoder-必须保持-h3-presentation条件载荷与原始媒体的所有权）
  - 第一批源码：Stage-0 prompt transform → `MiniMaxH3TextEncoder` → prefix-cache payload → Stage-1 H3 diffusion
- PR 描述信号：conditioned VAE、fixed seed、`fork_rng`、MUSA/device RNG
  - 规则：[[rules-cache-task-1]]（MMH3-2c；源锚点 #mmh3-2c-conditioned-vae-的固定种子必须按实际设备隔离并恢复）
  - 第一批源码：`pipeline_minimax_h3.py` condition encode caller → `vae.py::{encode_image,encode_video}`
- PR 描述信号：modular checkpoint、combined/partition task、两套 DiT、shared component
  - 规则：[[rules-cache-task-1]]（MMH3-2d；源锚点 #mmh3-2d-modular-h3-的-task-selector-必须同步权重能力与所有-dit-lifecycle）
  - 第一批源码：model index discovery → startup task selection → task-specific transformer/cache lifecycle
- PR 描述信号：request `quality`、lossless/high、dynamic Cache-DiT
  - 规则：[[rules-cache-task-1]]（MMH3-2e；源锚点 #mmh3-2e-quality-映射只决定-request-的-cache-dit-目标）
  - 第一批源码：request sampling → quality policy → request Cache-DiT runtime → denoise
- PR 描述信号：force-refresh hint、once/repeat、reinstall key
  - 规则：[[rules-cache-task-1]]（MMH3-2f；源锚点 #mmh3-2f-force-refresh-hint-属于-active-profile-identity）
  - 第一批源码：H3 `extra_args` validation → immutable cache config → installation key/refresh context
- PR 描述信号：TeaCache、FL2VA coefficients、0.17、combined/Ref2VA
  - 规则：[[rules-cache-task-1]]（MMH3-2g；源锚点 #mmh3-2g-h3-teacache-只绑定-fl2va-校准与-request-state）
  - 第一批源码：custom enabler → H3 extractor → module-resident hook state / per-generation reset
- PR 描述信号：distilled、DMD2、`base_schedule`、4-step、sigma boundary
  - 规则：[[rules-cache-task-2]]（MMH3-2h；源锚点 #mmh3-2h-distilled-sigma-schedule-按-partition-所有且以区间计步）
  - 第一批源码：partition model metadata → `DMD2SigmaSchedule` → H3 video/audio shifted sigmas
- PR 描述信号：LightX2V Turbo、legacy dynamic LoRA、packed QKV/FC1、five sigma points、DLO resident A/B sidecars
  - 规则：[[rules-cache-task-2]]（MMH3-2j；源锚点 #mmh3-2j-turbo-lora-只接受精确发布-artifact并与-h3-tasksampling-和-offload-lifecycle-共同门禁）
  - 第一批源码：`lora.py::load_minimax_h3_turbo_lora` → pipeline hook/sampling validation → `DiffusionLoRAManager`
- PR 描述信号：FlashGen native LoRA、grouped QKV、adapter sigma schedule、legacy manager binding
  - 规则：[[rules-cache-task-3]]（MMH3-2m；源锚点 #mmh3-2m-flashgen-native-lora-必须保持-artifactschedule-与-legacy-manager-边界）
  - 第一批源码：`npu/lora.py::load_minimax_h3_native_lora` → H3 pipeline active-adapter validation → unchanged `DiffusionLoRAManager` ^[PR #6666]
- PR 描述信号：FastH3 VSA、`vsa-datafree`、`FASTVIDEO_VSA`、four-step、load-time fusion
  - 规则：[[rules-cache-task-2]]（MMH3-2n；源锚点 #mmh3-2n-fasth3-只接受精确-artifact并将-vsa-gate-在启动时一次性融合）
  - 第一批源码：`fasth3.py` identity/strict fusion → pipeline gate injection/consumption → serving/request gate
- PR 描述信号：step execution、continuous batching、multi-document packing、rank-0 prepare failure
  - 规则：[[rules-cache-task-3]]（MMH3-2k；源锚点 #mmh3-2k-h3-step-execution-必须保持请求状态attention-文档和-rank-0-prepare-隔离）
  - 第一批源码：`pipeline_minimax_h3.py::{prepare_encode,denoise_step,step_scheduler}` → `batched_packing.py` → runner
- PR 描述信号：DLO、TP-local、resident layers、allocator cache、encoder/VAE staging
  - 规则：[[rules-deployment-1]]（MMH3-3a；源锚点 #mmh3-3a-h3-dlo-必须保持-loader-layout-与-component-stage-配对）
  - 第一批源码：H3 `_offload_plan` → `BoundedAllocatorCache`/`PinnedModuleStager` → pipeline encode/denoise/decode stage contexts
- PR 描述信号：RTX 5090/4090、24/32 GiB、consumer profile
  - 规则：[[rules-deployment-1]]（MMH3-3b；源锚点 #mmh3-3b-consumer-gpu-profile-是有边界的容量证据）
  - 第一批源码：recipe measurement commit/run record → exact target topology → quality/capacity validation
- PR 描述信号：4×H100、DFX perf、T2V/TI2V/V2V、synthetic H.264 reference
  - 规则：[[rules-deployment-1]]（MMH3-3c；源锚点 #mmh3-3c-h100-dfx-fixture-只证明-exact-nightly-workload-与-payload-path）
  - 第一批源码：nightly lane → perf JSON → benchmark request encoder/result artifact
- PR 描述信号：ROCm、gfx942/gfx950、AITER、BF16、support matrix
  - 规则：[[rules-deployment-1]]（MMH3-3d；源锚点 #mmh3-3d-rocm-support-必须按-sku镜像拓扑和测量协议限界）
  - 第一批源码：support table/footnote → recipe protocol → ROCm backend gate → exact hardware evidence
- PR 描述信号：DGX Spark、GB10、unified memory、FP8、offload/OOM
  - 规则：[[rules-deployment-1]]（MMH3-3e；源锚点 #mmh3-3e-gb10-unified-memory-容量证据不等于离散-gpu-offload-合同）
  - 第一批源码：single-partition recipe → allocator/header evidence → output probe
- PR 描述信号：RTX PRO 6000、TP2、Ulysses、2/4/8 GPU、PCIe
  - 规则：[[rules-deployment-2]]（MMH3-3f；源锚点 #mmh3-3f-rtx-pro-6000-scaling-只绑定单机-t2va-协议）
  - 第一批源码：topology → exact warmed T2VA measurements → memory method
- PR 描述信号：Ascend packed varlen、LaserAttention、mask churn、E2E/HBM
  - 规则：[[rules-deployment-2]]（MMH3-3g；源锚点 #mmh3-3g-ascend-mask-free-数字只绑定报告的-h3-packed-workload）
  - 第一批源码：H3 opt-in → exact NPU topology/workload → kernel/E2E/memory evidence
- PR 描述信号：H100_2 merge、FL2VA/Ref2VA DP2、Turbo、FastH3
  - 规则：[[rules-deployment-2]]（MMH3-3m；源锚点 #mmh3-3m-h100_2-merge-lane-只覆盖精确-h3-ci-matrix）
  - 第一批源码：one CI job → four isolated pytest processes → bounded media assertions
