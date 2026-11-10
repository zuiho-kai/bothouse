---
name: ci-overview-2
description: vLLM-Omni CI 入口（2/2）：Diffusion GGUF nightly 插件 pin（vllm-gguf-plugin==0.0.4）、NPU attention selector 回归、Qwen-Image nightly 矩阵与 step-execution perf、HunyuanVideo-1.5 ready/merge/nightly、XPU 基镜像解析、AMD CI stabilization 边界，以及 CI 目录“遇到什么查哪里”对照表
metadata:
  scope: 只收源目录 repos/vllm-omni/ci 根索引页后半的覆盖边界记录和目录内容对照表；前半（MiniCPM、dots.tts、LTX-2、MiniMax-H3、FLUX.2、MXFP4、SVDQuant）见 ci-overview-1，CI 指南入口归 ci-guides-overview，错题入口归 ci-incidents-overview
---
# vLLM-Omni CI（2/2）

## 现状

- 拆分说明：本页是源页 `_index.md` 的第 2/2 部分；第 1 部分 [[ci-overview-1]]

### Diffusion GGUF nightly plugin compatibility

- The L4 full-model diffusion-quantization nightly lane installs `vllm-gguf-plugin==0.0.4`, rather than the floating `>=0.0.3`: the later resolved 0.0.5 imports `huggingface_hub.ResolvedRevision`, which the lane's existing `huggingface_hub` does not export,
  - so plugin loading and `gguf` registration fail before the tests run. This is a temporary CI-environment reproducibility pin, not a runtime support or package-dependency claim. Remove it only after a plugin release is compatible with that environment or declares the required minimum hub version.
- The scoped command is `pytest -sv tests/diffusion/quantization -m 'full_model and cuda and L4' --run-level full_model`; its two GGUF cases cover Z-Image-Turbo and FLUX.2-klein.
  - PR evidence reports local loading/registration recovery, while the L4 full-model run was deferred to Buildkite, so do not record a full test pass from this change alone.
  - A parent-side GGUF import/pin is insufficient for spawned stages: the child must reload general plugins before engine construction; this is not post-change full-model proof. ^[PR #6303 / issue #6022] ^[PR #6750]

### NPU diffusion-attention selector regression boundary

- `tests/platforms/npu/test_diffusion_attn_backend_selector.py` is CPU-marked and loads the NPU platform module with fake vLLM/vLLM-Ascend dependencies. It isolates eager `mindiesd` import selection for FLASH, hub FLASH fallbacks, RAINFUSION, and SDPA plus missing-package fallback behavior.
  - It is selector regression coverage only: it neither requires an NPU or MindIE-SD install nor establishes CANN registration or real Ascend-kernel execution. ^[PR #6054]

### Qwen-Image nightly coverage and step-execution perf sharing

- The Qwen-Image online-serving expansion keeps nine feature pytest IDs, but assigns one checkpoint to each case: Qwen-Image covers CPU offload, TeaCache, Ulysses degree 2, CFG parallel size 2, and HSDP shard size 2; Qwen-Image-2512 covers step execution, layerwise offload, Ring degree 2,
  - and VAE patch parallel size 2. Single-card versus two-card H100 marks remain attached to those cases. This is a nightly coverage matrix, not evidence that either checkpoint is interchangeable for runtime behavior or numeric output.
- The Qwen-Image step-execution perf config uses one H100 server with profiler, `step-execution`, and `max-num-seqs: 8` for sequential 512x512/20-step and 1536x1536/35-step cases plus the 512x512/20-step concurrency 1/2/4/8 sweep.
  - Keep the three `benchmark_params` under that shared server and retain their existing H100 baseline artifacts; the JSON change itself does not establish a performance result or an active regression threshold. ^[PR #6613]

### HunyuanVideo-1.5 ready/merge and nightly coverage

- The basic one-H100 CPU-offload T2V online-serving row is marked `core_model` and `advanced_model`, and the ready and merge Buildkite jobs select it with the matching run level.
  - The CacheDiT + layerwise CPU-offload one-card row and CacheDiT + TP=2 + VAE patch-parallel=2 (with VAE tiling) two-card row are `full_model` only, so their function coverage remains in the nightly H100×2 lane.
  - This is deliberately a scope split, not evidence that the richer combinations run in ready/merge. ^[PR #6349]
- The dedicated nightly DFX job runs separate T2V and I2V JSON configs: random data, ten prompts at concurrency one, seed 42, negative prompt, and 832×480 / 33-frame / four-step / 24-fps requests. Each has a one-H100 baseline and a two-H100 CacheDiT/TP2/VAE-patch-parallel=2/tiling case.
  - It uploads result JSON and logs but configures no threshold, so it is benchmark-report/artifact collection rather than a performance regression gate. ^[PR #6349]

### XPU base-image resolution and support-table boundary

- The Intel Buildkite XPU lane and Docker default must target the same checkout release. Its Omni image layers on `vllm/vllm-openai-xpu:${VLLM_VERSION}` and clears that image's serving entrypoint so the result remains a shell/test container.
  - The base carries the matching XPU runtime and vLLM; Omni installs only its own layers. Keep the Dockerfile default and lane environment version aligned; the source PR #8528 aligns both and the install command to v0.31.0. ^[PR #8528]
- Before building, CI pulls the published upstream base freshly. If that pull fails it may use an existing local copy; only if neither exists does it build the same vLLM tag from upstream `docker/Dockerfile.xpu`, optionally under `VLLM_BASE`.
  - Thus a fallback is provenance-aligned, but it is not evidence that an arbitrary pre-existing fallback image matches the published tag.
  - The in-container scope remains the B60-marked core/advanced/omni pytest selections plus `test_mxfp8_config.py`; it is not a whole-suite or model-matrix validation.
  - The PR author reported CI passing but supplied no command output or completed test plan, and review had no surviving findings, so retain those evidence limits. ^[PR #6727]

### AMD CI stabilization boundary

- AMD merge lanes may combine READY and MERGE definitions only through the bootstrap's explicit `DEBUG_TEST_YAML=merge,ready` override; the merged YAML shares one build step and preserves each suite as a named group.
  - This is a maintainer debugging control, not a change to the normal branch-based READY-versus-MERGE selection.
- Long MI300 diffusion shards carry explicit Buildkite timeouts, while a known long-running Qwen3-TTS CustomVoice `async_chunk` Whisper-validation case is an 80-minute, `NonBlocking` quarantined step.
  - It must return to the blocking sharded lane only after the AMD failure is resolved; a passing neighboring shard does not establish that result.
- ROCm offload memory assertion现在由实际diffusion worker内同步reset/read的process-local allocator peak支持，不能用parent device-global total-free减initial归因model saving；RPC返回 rank0不证明all-rank max。机制/quality证据边界见[[rules-worker-observability]]（DIFF-4x）。
  - cleanup diagnostics仍有独立timeout，保守offload floor不构成portability或performance保证。^[PR #6704] ^[PR #8189]

### 目录内容

- [[rules-graph-buffer-fixtures]]（Graph 测试 buffer） — fake estimator 未写 tail 的确定性初始化。

| 遇到什么 | 查看哪里 |
|---|---|
| 构建wheel runtime data、无VCS archive parity或声明Python版本的安装/导入支持 | [[rules-build-compatibility]]（构建与版本合同） |
| 审查硬件 lane（含 MiniMax-H3 DLO DP2 ready smoke 的证据边界）、回归 fence、CI 工具供应链、ASR 文本比较或 xdist/shared fixture、Buildkite 失败日志与运行时差异 | [[ci-rules-1]]、[[ci-rules-2]]、[[ci-rules-3]]（CI rules）   新增核对：OMNI-CI-1g、OMNI-CI-1h。 |
| AMD/ROCm timeout、quarantine、memory signal、single-card diffusion job 的 multi-card marker 排除、Qwen3-TTS argv 或 Qwen3-Omni control-plane fixture | [[rules-amd]]（AMD/ROCm CI rules）   新增核对：OMNI-CI-2i、OMNI-CI-2i2、OMNI-CI-2i3、OMNI-CI-2i4、OMNI-CI-2i5、OMNI-CI-2i6。 |
| CUDA L4 Kubernetes preset、GPU-count shard、resource/retry policy | [[rules-l4-k8s]]（L4 Kubernetes CI rules） |
| Whisper 转写 helper 的 GPU 首选、16 GiB 门槛、CPU fallback 或 CUDA ready/merge source dependency | [[rules-whisper-transcription]]（Whisper 转写 CI 规则） |
| 查看仓库特有 CI 陷阱 | [[ci-guides-overview]]（CI guides） |
| 调查历史 CI 失败 | [[ci-incidents-overview]]（CI incidents） |

- [[rules-test-fixtures]]（CI 并行测试与 engine fixture 合同）：`OMNI-CI-2b`, `OMNI-CI-2c`, `OMNI-CI-2d`, `OMNI-CI-2h`。
- [[rules-review-validation]]（rules-review-validation） 新增核对：VOMNI-CI-1a、VOMNI-CI-1b。
- [[release-gates]]（release-gates）：维护者分工与发布政策。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, ci；created: 2026-07-10；updated: 2026-10-06
