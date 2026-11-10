---
name: model-executor-rules-1
description: Model Executor 规则（1/3）代码地图：Direct 代码快速入口表（PR 描述信号到 EXEC-1 至 EXEC-13 各规则组）与完整代码路由（EXEC-0a、EXEC-0b，strict-stage-config、connector-capability、runner-preprocess、stage-runtime、bridge-batch、loader-contract、async-output、platform-backends、mtp-graph、image-task-envelope 各组的第一批 live 源码），以及本页 sources 列表
metadata:
  scope: 只收 Model Executor 规则页的两张路由表、EXEC-0a / EXEC-0b 和源页 sources；严格配置校验 EXEC-3a 至 EXEC-4c 与 runner 预处理合同见 model-executor-rules-2，async output、stage 并行度与 EXEC-14a 至 EXEC-16a 见 model-executor-rules-3，bridge/batch 归 rules-bridge-batch-1、rules-bridge-batch-2
---
# Model Executor 规则（1/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/3 部分；第 2 部分 [[model-executor-rules-2]]；第 3 部分 [[model-executor-rules-3]]
- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-07-10；updated: 2026-09-05
- 来源（sources）：vllm_omni/worker/gpu_model_runner.py；vllm_omni/worker/gpu_ar_model_runner.py；vllm_omni/platforms/interface.py；vllm_omni/platforms/musa/platform.py；vllm_omni/platforms/npu/worker/npu_ar_model_runner.py；vllm_omni/platforms/npu/worker/npu_generation_model_runner.py
  - vllm_omni/platforms/npu/worker/npu_model_runner.py；vllm_omni/engine/stage_init_utils.py；vllm_omni/utils/mm_outputs.py；tests/worker/test_omni_gpu_model_runner.py；tests/worker/test_gpu_ar_model_runner.py；docs/design/feature/omni_async_output_materialization.md
  - vllm_omni/config/model.py；vllm_omni/config/stage_config.py；vllm_omni/config/omni_config.py；vllm_omni/engine/stage_runtime.py；vllm_omni/engine/stage_engine_startup.py；tests/engine/test_async_omni_engine_stage_init.py；vllm_omni/experimental/fullduplex/；tests/e2e/features/fullduplex/
  - vllm_omni/model_executor/models/common/qwen3_code_predictor.py；vllm_omni/model_executor/models/qwen3_omni/qwen3_omni.py；vllm_omni/model_executor/models/qwen3_tts/configuration_qwen3_tts.py；vllm_omni/diffusion/models/minimax_h3/encoder.py；vllm_omni/model_extras/registry.py
  - examples/offline_inference/text_to_image/text_to_image.py；examples/offline_inference/image_to_video/image_to_video.py；tests/diffusion/models/minimax_h3/test_minimax_h3_contract.py；tests/examples/offline_inference/test_image_task_prompts.py；tests/engine/test_arg_utils.py；PR #3422
  - PR #3642；PR #4730；PR #4958；PR #5073；PR #5074；PR #5310；PR #5610；PR #5671；PR #5777；PR #5792；PR #5824；PR #5957；PR #5976；PR #6049；vllm_omni/engine/arg_utils.py；vllm_omni/model_executor/models/qwen3_omni/qwen3_omni_moe_thinker.py
  - vllm_omni/model_executor/models/qwen2_5_omni/qwen2_5_omni_thinker.py；vllm_omni/model_executor/models/dynin_omni/dynin_omni.py；vllm_omni/engine/async_omni_engine.py；vllm_omni/worker/base.py；vllm_omni/worker/gpu_generation_model_runner.py
  - tests/model_executor/models/qwen3_omni/test_qwen3_omni_forward_contract.py；claude-workflow-starter-private@09dca46；PR #4795；PR #5842；vllm_omni/model_executor/stage_input_processors/nemotron_voicechat.py
  - vllm_omni/model_executor/models/nemotron_voicechat/nemotron_voicechat_code2wav.py；PR #5146；PR #5068；PR #5174；PR #6076；PR #6096；PR #4765；PR #5886；PR #6061；vllm_omni/platforms/npu/platform.py；vllm_omni/platforms/npu/models/minimax_h3.py；PR #5666；PR #6152；PR #5877
  - vllm_omni/transformers_utils/configs/sensenova_u1.py；PR #6119；PR #6346；PR #5452；PR #6306；vllm_omni/worker/omni_connector_model_runner_mixin.py；vllm_omni/worker/omni_connector_validation.py；PR #6149；PR #4322；PR #6674；PR #6813；PR #6775

### Direct 代码快速入口

| PR 描述信号 | 规则入口 |
|---|---|
| stage schema、projection、known fields | `EXEC-3a` |
| connector capability、worker/runner selection | `EXEC-3c` |
| runner preprocess、exact-shape input、MTP | `EXEC-4e` 与本页 runner 合同 |
| stage TP/PP/DP、replica、device capacity | `EXEC-3d` |
| runtime info、request RNG、bridge/batch/embedding width | `EXEC-1a`–`EXEC-1i`；[[rules-bridge-batch-1]]、[[rules-bridge-batch-2]]（bridge/batch） |
| loader、checkpoint config、snapshot/subdir、packed weights | `EXEC-2a`–`EXEC-2i`；[[rules-loader-contract]]（loader） |
| async output、MTP graph、output types | `EXEC-4c`、`EXEC-5a`–`5b`、`EXEC-7a`–`7b` |
| NPU/ROCm/MUSA/XPU runner/backend | `EXEC-10a`–`EXEC-13h`；[[rules-platform-backends-1]]、[[rules-platform-backends-2]]（platform backends） |
| image/video task envelope、`model_extras` | `EXEC-6a`–`EXEC-6d`；[[rules-image-task-envelope]]（image task envelope） |
| preprocess phase/one-token prefill、sampling/codec hot path | `EXEC-4f`、`EXEC-8a`、`EXEC-9a`、`EXEC-11a`–`11h`；[[rules-runtime-hot-paths]]（runtime hot paths） |

### 完整代码路由

- [EXEC-0a] **EXEC-0a — PR 描述先选代码地图。** Direct review 先按 title/body 声明的 runner、stage、bridge、loader 或设备语义命中下表，再用 pinned changed files 验证真实模型 consumer；路径只负责范围反查。
- [EXEC-0b] **EXEC-0b — 共享 producer 先于模型补丁。** 命中共享 runner、stage runtime 或 bridge producer 后立即沿 live consumer 审查；只有 producer 正确且问题只属于一个模型时才进入该模型 owner。
- （以下为原表格，按行改写为条目）
- PR 描述在做什么：strict stage config、known-fields/projection、service/stage 字段归属、runtime config
  - 精确规则组：`strict-stage-config`：`EXEC-3a`
  - 第一批 live 源码：`vllm_omni/config/stage_config.py::{build_stage_runtime_overrides,_build_engine_args}` → `vllm_omni/config/omni_config.py::{_build_common_stage_config_kwargs,VllmOmniConfig.from_pipeline_config}` → 真实 startup consumer
- PR 描述在做什么：connector-required stage、worker/runner selection、platform worker capability
  - 精确规则组：`connector-capability`：`EXEC-3c`
  - 第一批 live 源码：`engine/arg_utils.py::OmniEngineArgs.__post_init__` → `worker/omni_connector_validation.py::validate_worker_omni_connector` → selected `worker_cls.model_runner_cls`
- PR 描述在做什么：runner `_preprocess`、逐请求 metadata、prefill/decode phase、batch preprocess、MTP
  - 精确规则组：`runner-preprocess`：本页“Runner 到模型的预处理合同”
  - 第一批 live 源码：`vllm_omni/worker/gpu_model_runner.py::{OmniGPUModelRunner._maybe_run_batch_preprocess,_preprocess,_build_model_kwargs_extra,_talker_mtp_forward}` → `vllm_omni/model_executor/models/<命中模型>` consumer
- PR 描述在做什么：CUDA/NPU graph bucket padding、`seq_token_counts` 与 flat `input_ids`、codec exact-shape opt-in
  - 精确规则组：`runner-preprocess`：`EXEC-4e`
  - 第一批 live 源码：GPU/NPU generation runner `_preprocess` → `maybe_unpad_input_ids` → codec model `torch.split` consumer
- PR 描述在做什么：stage TP/PP/DP、devices、replica、inline/subprocess、visible devices、worker 启动、容量 fail-fast
  - 精确规则组：`stage-runtime`：`EXEC-3d` + 本页“Stage 并行度和设备容量必须一起验收”
  - 第一批 live 源码：`vllm_omni/config/stage_config.py::build_stage_runtime_overrides` → `vllm_omni/engine/stage_runtime.py::{StageRuntime.initialize,StageRuntime._resolve_replica_physical_devices}` → `stage_engine_startup.py::{launch_stage_replica,get_headless_replica_devices}`
- PR 描述在做什么：`runtime_info`、request RNG、batch compaction、跨 stage bridge/串线
  - 精确规则组：`bridge-batch`：`EXEC-1a`–`1c`
  - 第一批 live 源码：shared runner request state → stage input processor → model consumer
- PR 描述在做什么：cross-stage embedding width、pre-projection buffer
  - 精确规则组：`bridge-batch`：`EXEC-1d`
  - 第一批 live 源码：stage HF config → `get_inputs_embeds_size()` → `GPUARModelRunner.inputs_embeds` → model projection
- PR 描述在做什么：loader dtype、只取 checkpoint config、避免整仓权重下载
  - 精确规则组：`loader-contract`：`EXEC-2a`
  - 第一批 live 源码：`vllm_omni/model_executor/model_loader/weight_utils.py::download_weights_from_hf_specific` → `vllm_omni/model_executor/models/<命中模型>` loader
- PR 描述在做什么：stage `model_subdir`/`tokenizer_subdir`、partial snapshot、revision/cache repair
  - 精确规则组：`loader-contract`：`EXEC-2h`
  - 第一批 live 源码：`engine/stage_init_utils.py` → stage engine args → model-specific root resolver
- PR 描述在做什么：fused projection、HF source shard 完整性、consumer 委托、packed TP
  - 精确规则组：`loader-contract`：`EXEC-2b`, `EXEC-2i`
  - 第一批 live 源码：H3 text encoder fused owner；nested wrapper 的 required callable 必须在 concrete runtime object 上委托
- PR 描述在做什么：async Omni output、background builder、D2H snapshot、connector drain/fallback
  - 精确规则组：`async-output`：`EXEC-5a`
  - 第一批 live 源码：`worker/gpu_ar_model_runner.py::{_should_use_async_omni_output,OmniAsyncGPUModelRunnerOutput}` → platform runner → connector output
- PR 描述在做什么：upstream runner/output API drift、`num_nans`、sample-budget 或 quant loader helper moved
  - 精确规则组：`async-output` + output-contract
  - 第一批 live 源码：live upstream runner/output dataclasses → `gpu_{ar,generation}_model_runner.py` / `outputs/output_processor.py` → diffusion quant configs；moved symbol 必须用目标 release 的 canonical import，而非保留旧 fallback ^[PR #6606]
- PR 描述在做什么：NPU ngram speculative decode、`SchedulerOutput` mutable map、profiling timing 或 upstream NPU runner ownership
  - 精确规则组：`platform-backends`：`EXEC-10e`, `EXEC-13h`
  - 第一批 live 源码：`platforms/npu/worker/{npu_ar_model_runner,npu_generation_model_runner,npu_model_runner}.py` → inherited invalid-draft trimming / profiler gate → upstream vLLM-Ascend owner
- PR 描述在做什么：Talker-MTP FULL graph、平台 capture 能力、显式 opt-out
  - 精确规则组：`mtp-graph`：`EXEC-4c`
  - 第一批 live 源码：`platforms/interface.py::supports_talker_mtp_graph_capture` → platform override → model `talker_mtp_graph_safe` → `OmniGPUModelRunner._init_talker_mtp`
- PR 描述在做什么：`model_extras`、shared T2I/T2V/I2V example、canonical prompt envelope 或 video output consumer
  - 精确规则组：`image-task-envelope`：`EXEC-6a`, `EXEC-6d`
  - 第一批 live 源码：`examples/offline_inference/{text_to_image/text_to_image.py,text_to_video/text_to_video.py,image_to_video/image_to_video.py}` → `model_extras/registry.py::{build_text_to_image_prompt,build_image_to_video_prompt}` → model pipeline validation
- PR 描述在做什么：CosyVoice3 non-module TensorRT CFM、stream/event ownership、raw-pointer buffer lifetime 或 context-pool reuse
  - 精确规则组：[[cosyvoice3-rules]]（CosyVoice3 TensorRT handoff）：`COSYVOICE3-1a`
  - 第一批 live 源码：`code2wav_core/cfm.py::ConditionalCFM.forward_estimator` → `flow_estimator_trt.py::TrtContextWrapper`
- PR 描述在做什么：Qwen3-TTS adaptive chunk、EWMA target、all-frame emit、controller cleanup
  - 精确规则组：[[qwen3-tts-rules-2]]（Qwen3-TTS adaptive ramp；源锚点 #q3tts-3e-adaptive-ramp-是-host-side每段-opt-in-控制器不是-cuda-graph-计划）
  - 第一批 live 源码：`stage_input_processors/qwen3_tts.py::talker2code2wav_async_chunk` → `chunk_size_utils.py::{AdaptiveChunkController,compute_adaptive_emit}` → Code2Wav
- PR 描述在做什么：Qwen3-Omni audio encoder 的 head/TP divisibility
  - 精确规则组：[[qwen-omni-rules]]（Qwen-Omni audio-encoder TP rule；源锚点 #qomni-1d-audio-encoder-tp-必须按-head-divisibility-局部回退）
  - 第一批 live 源码：`qwen3_omni_moe_thinker.py::{Qwen3OmniMoeAudioAttention,Qwen3OmniMoeAudioEncoderLayer}`；只影响该 encoder layer 的 QKV/output/FFN TP fallback ^[PR #4322]
