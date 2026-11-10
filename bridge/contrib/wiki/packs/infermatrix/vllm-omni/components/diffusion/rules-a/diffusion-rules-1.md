---
name: diffusion-rules-1
description: Diffusion 共享规则（1/3）代码地图：Direct 代码快速入口（PR 描述信号→DIFF 规则入口）与完整代码路由表（DIFF-0a、DIFF-0b；execution-parity、checkpoint-distributed、quality-evidence、distributed-vae、system-runtime、metrics-evidence、output-runtime 各规则组及第一批 live 源码）
metadata:
  scope: 只收 Diffusion 共享规则的使用说明与按 PR 描述到规则组、live 源码的路由表；DIFF-1a 至 DIFF-1p 的规则正文归 diffusion-rules-2，DIFF-1x 至 DIFF-10c 与 VLLM-OMNI-PR8510-MHC-FP32-MUSA 归 diffusion-rules-3，平台 kernel 的 DIFF-1t 至 1w 归 rules-platform-kernels
---
# Diffusion 共享规则（1/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/3 部分；第 2 部分 [[diffusion-rules-2]]；第 3 部分 [[diffusion-rules-3]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-07-20；updated: 2026-10-09
- 来源（sources）：PR #7648；PR #4341；PR #5001；PR #5087；PR #5088；PR #5136；PR #5255；PR #5344；PR #5543；PR #5720；PR #5737；PR #5764；PR #5801；PR #5802；PR #5838；PR #5839；PR #5848；PR #5872；PR #5881；PR #5896；PR #5981；PR #6094；PR #6102；PR #6279；PR #6385；PR #6445；PR #6651；PR #6722；PR #5831；PR #6989
  - vllm_omni/diffusion/attention/backends/flashinfer_attn.py；vllm_omni/diffusion/attention/backends/ring/ring_kernels.py；vllm_omni/diffusion/attention/parallel/ulysses.py；vllm_omni/diffusion/cache/cachedit/backend.py；vllm_omni/diffusion/data.py；vllm_omni/diffusion/distributed/hsdp.py
  - vllm_omni/diffusion/executor/multiproc_executor.py；vllm_omni/diffusion/layers/norm.py；vllm_omni/diffusion/layers/rope.py；vllm_omni/diffusion/lora/manager.py；vllm_omni/diffusion/model_loader/diffusers_loader.py；vllm_omni/diffusion/model_metadata.py；vllm_omni/diffusion/offloader/
  - vllm_omni/diffusion/registry.py；vllm_omni/diffusion/worker/diffusion_model_runner.py；vllm_omni/diffusion/worker/diffusion_worker.py；vllm_omni/engine/async_omni_engine.py；vllm_omni/entrypoints/openai/api_server.py；vllm_omni/quantization/component_config.py
  - vllm_omni/quantization/factory.py；tests/diffusion/attention/test_attention_sp.py；tests/diffusion/attention/test_ulysses_uaa.py；tests/diffusion/cache/test_cache_backends.py；tests/diffusion/layers/test_norm.py；tests/diffusion/layers/test_rope_broadcast.py
  - tests/diffusion/offloader/test_distributed_layerwise_backend.py；tests/diffusion/test_diffusion_config_propagation.py；tests/diffusion/test_multiproc_engine_concurrency.py；PR #4755；PR #5990；vllm_omni/diffusion/layers/fused_qk_norm_rope.py
  - vllm_omni/diffusion/cache/teacache/extractors.py；vllm_omni/diffusion/models/minimax_h3/minimax_h3_transformer.py；tests/diffusion/layers/test_fused_qk_norm_rope.py；PR #6165；PR #5677；vllm_omni/diffusion/quantization/hsdp_fp8.py；tests/diffusion/quantization/test_hsdp_fp8.py；PR #4845
  - PR #6173；PR #6070；vllm_omni/diffusion/models/ltx2/ltx2_components.py；vllm_omni/diffusion/model_loader/hub_prefetch.py；PR #5910；PR #5676；PR #6125；PR #6320；PR #5877；vllm_omni/diffusion/vllm_config.py；PR #6283；vllm_omni/diffusion/layers/activation.py；PR #6281
  - vllm_omni/diffusion/attention/ops/minimax_h3_modulation.py；PR #6130；PR #6364；PR #6073；PR #4820；vllm_omni/diffusion/attention/backends/fastvideo_vsa.py；PR #6150；PR #6410；tests/diffusion/layers/test_activation.py；tests/diffusion/layers/test_fused_qk_norm_rope_npu.py；PR #8510
- 置信度（confidence）：high
- 只有 `DIFF-数字字母` 是可审计规则 ID。模型专有常量和已验证偏差留在对应 [[models-overview]]（模型 owner）；本页只承载多个 diffusion 模型共用的不变量。
- 相关专题：[[rules-platform-kernels]]（Diffusion 平台 kernel 与设备合同）（`DIFF-1t`, `DIFF-1u`, `DIFF-1v`, `DIFF-1w`）。

### Direct 代码快速入口

| PR 描述信号 | 规则入口 |
|---|---|
| custom-op mutable schema | `DIFF-10c` |
| graph/eager、compile、solver、RNG、dtype/device | `DIFF-1a`–`DIFF-1j` |
| checkpoint remap、HWR、HSDP、offload、quantization、TorchAO `.bin` index fallback | `DIFF-2a`–`DIFF-2z`、`DIFF-2af`；[[rules-checkpoint-loading-1]]、[[rules-checkpoint-loading-2]]（checkpoint/loading） |

- （以下为原表格，按行改写为条目）
- PR 描述信号：component、multi-DiT、LoRA、request cache lifecycle
  - 规则入口：[[rules-component-lifecycle]]（component lifecycle）、[[rules-lora-1]]、[[rules-lora-2]]（LoRA）
- PR 描述信号：quality evidence、distributed VAE
  - 规则入口：`DIFF-3a`、`DIFF-3b`
- PR 描述信号：paged KV、attention backend/parallel、platform、admission、AR-Diffusion K/V pool 与 stepwise rollout
  - 规则入口：`DIFF-4a`–`DIFF-4x`、`DIFF-4aa`–`DIFF-4ac`；[[rules-system-runtime-1]]、[[rules-system-runtime-2]]（system runtime）；equal-rank SP auto-pad `DIFF-1ah`、等长 batch mask 省略 `DIFF-1af` [[rules-attention-1]]、[[rules-attention-2]]、[[rules-attention-3]]（attention）
- （以下为原表格，按行改写为条目）
- PR 描述信号：worker reply、shutdown、final output/formatter、mid-stream interaction
  - 规则入口：`DIFF-1s`、`DIFF-1aa`、`DIFF-1ag`、`DIFF-4z`；[[rules-output-lifecycle-1]]、[[rules-output-lifecycle-2]]（output/runtime）
- （以下为原表格，按行改写为条目）
- PR 描述信号：service/forward/step metrics
  - 规则入口：`DIFF-5a`、`DIFF-5b`；[[diffusion-rules-metrics]]（metrics）
- PR 描述信号：worker title/rank observability
  - 规则入口：`DIFF-4w`；[[rules-worker-observability]]（worker observability）

### 完整代码路由

- [DIFF-0a] **DIFF-0a — PR 描述先选共享执行地图。** 按 title/body 的 graph、RNG、checkpoint、HSDP、quantization 或质量信号命中下表，再用 pinned files 验证 owner。
- [DIFF-0b] **DIFF-0b — 共享 runner 与模型 pipeline 分层。** 先查命中行的共享 producer；只有 live 调用链落到单模型 pipeline/checkpoint/常量时才进入模型 owner，不横扫其他模型。
- （以下为原表格，按行改写为条目）
- PR 描述在做什么：CUDA Graph、compile、fused solver/norm/RoPE、FA determinism、eager parity、tensor dtype/device、async output/teardown
  - 精确规则组：`execution-parity`：`DIFF-1a`–`1j`
  - 第一批 live 源码：`compile.py::regionally_compile` → shared layer/backend → model denoise/output pump/shutdown
- PR 描述在做什么：seed、request-local generator、guidance=0、并发 RNG、batched generators
  - 精确规则组：`execution-parity`：`DIFF-1b`
  - 第一批 live 源码：`inputs/data.py::OmniDiffusionSamplingParams` → runner `_initialize_generator` → request-batch generator collate
- PR 描述在做什么：ModelOpt/checkpoint adapter、weight/scale remap、unknown tensor、resolution path
  - 精确规则组：`checkpoint-distributed`：`DIFF-2a`
  - 第一批 live 源码：`diffusers_loader.py::{_get_checkpoint_adapter,load_weights}` → `modelopt.py::{_resolve_target_and_output_names,adapt}`
- PR 描述在做什么：host-weight artifact、source identity、layout/dtype、warm restore、no-AllGather DLO selection
  - 精确规则组：`checkpoint-distributed`：`DIFF-2d`, `DIFF-2z`
  - 第一批 live 源码：`model_loader/host_weight_loader.py::_resolve_hwr` → `model_loader/host_weights/{source_identity,contracts,identity_adapter}.py` → policy/restorer
- PR 描述在做什么：HSDP/FSDP、`fully_shard`、DeviceMesh、packed/scalar parameter、FP8
  - 精确规则组：`checkpoint-distributed`：`DIFF-2b`
  - 第一批 live 源码：`distributed/hsdp.py::{apply_hsdp_to_model,shard_model}` → loader `_load_model_with_hsdp` → `hsdp_fp8.py`
- PR 描述在做什么：distributed layerwise offload、AllGather、异构 block、shared buffer
  - 精确规则组：`checkpoint-distributed`：`DIFF-2e`
  - 第一批 live 源码：`offloader/distributed_layerwise_backend.py::{DistributedLayerwiseOffloadHook.initialize_hook,prefetch_layer,DistributedLayerwiseOffloadBackend._allocate_shared_buffers}`
- PR 描述在做什么：DLO+AllGather、DP wave、result queue、shutdown、constructor cleanup
  - 精确规则组：`checkpoint-distributed`/`execution-parity`：`DIFF-2k`, `DIFF-1d/1g/1h/1j`
  - 第一批 live 源码：request compatibility key → multi-rank RPC → worker-owned queue/pump → bounded teardown
- PR 描述在做什么：component quantization、text encoder/transformer/VAE 独立配置、owner prefix、meta/offload
  - 精确规则组：`checkpoint-distributed`：`DIFF-2c`
  - 第一批 live 源码：`quantization/factory.py::{build_quant_config,resolve_quant_config_from_disk}` → `component_config.py::ComponentQuantizationConfig.resolve` → `data.py::_propagate_quantization_from_tf_config` → component linear consumer
- PR 描述在做什么：modular/multi-DiT、`_dit_modules`、request-scoped Cache-DiT/compile/SP/LoRA/offload lifecycle
  - 精确规则组：`checkpoint-distributed`：`DIFF-2f`–`2j`
  - 第一批 live 源码：request batch key → model policy/cache runtime；pipeline component list → shared consumers
- PR 描述在做什么：loader-owned offload plan、backend enable/prefetch failure、fresh canonical retry
  - 精确规则组：`checkpoint-distributed`：`DIFF-12a`
  - 第一批 live 源码：`offloader/startup.py` → `offloader/__init__.py::enable_offload_backend` → runner
- PR 描述在做什么：LPIPS/PSNR/相似度阈值、CPU offload、量化质量证据
  - 精确规则组：`quality-evidence`：`DIFF-3a`
  - 第一批 live 源码：changed exact case → runner `execute_model` → model pipeline；A/B 同路径
- PR 描述在做什么：Wan VAE spatial shard、gather/trim/reshard、empty tail、attention extent
  - 精确规则组：`distributed-vae`：`DIFF-3b`
  - 第一批 live 源码：`distributed/autoencoders/wan_spatial_shard.py` → patched decoder attention/conv → gather final frame
- PR 描述在做什么：完整图像 batch VAE decode、native tiling 与 gather 顺序
  - 精确规则组：[[rules-vae-batch]]（DIFF-VAE-BATCH-1a）
  - 第一批 live 源码：`distributed/autoencoders/autoencoder_kl.py` batch split → native decode → ordered gather
- PR 描述在做什么：paged KV/cache、backend/platform、GQA/layout、Ring/Ulysses、SymmMem A2A、FlashInfer quant、masked cross-attention、预算与 admission
  - 精确规则组：`system-runtime`：`DIFF-4a`–`4j`, `DIFF-4v`, `DIFF-4x`
  - 第一批 live 源码：engine init → metadata/config → attention parallel/backend → platform hook → scheduler/serving
- PR 描述在做什么：worker/RPC 异常、rank-status、traceback/device cache 清理
  - 精确规则组：`system-runtime`：`DIFF-4d`；reply ownership 见 [[rules-output-lifecycle-1]]、[[rules-output-lifecycle-2]]（output/runtime） `DIFF-4z`
  - 第一批 live 源码：`diffusion_worker.py::{_execute_rpc,_worker_busy_loop}` 的 execute/reply/status 路径
- PR 描述在做什么：worker title、log prefix、DP/PP/SP/CFG/TP/FS/RP/EP local rank
  - 精确规则组：[[rules-worker-observability]]（worker observability）：`DIFF-4w`
  - 第一批 live 源码：`diffusion_worker.py::_setup_diffusion_worker_proc_title_and_log_prefix` → `distributed/parallel_state.py` group getters
- PR 描述在做什么：image/diffusion service time、forward time、missing-versus-zero、per-step metric
  - 精确规则组：[[diffusion-rules-metrics]]（`metrics-evidence`）：`DIFF-5a`, `DIFF-5b`
  - 第一批 live 源码：output formatter/sampling metadata → stage stats aggregation → serving Prometheus emission
- PR 描述在做什么：image/video/audio/action final type、registry alias、endpoint capability、formatter
  - 精确规则组：[[rules-output-lifecycle-2]]（`output-runtime`；源锚点 #diff-1s-diffusion-output-type-必须从模型声明闭合到-topology-与-formatter）：`DIFF-1s`
  - 第一批 live 源码：`model_metadata.py` → default/multi-stage config → video capability → `output_formatter.py`
- PR 描述在做什么：Diffusers/custom/native executor identity、hook、batch capability、frame interpolation
  - 精确规则组：[[rules-output-lifecycle-1]]（`output-runtime`；源锚点 #diff-1aa-diffusers-execution-backend-不得冒充-native-checkpoint-identity）：`DIFF-1aa`
  - 第一批 live 源码：`data.py::uses_diffusers_adapter` → `diffusion_engine.py::supports_request_batch` → registry hook / adapter sampling validation
