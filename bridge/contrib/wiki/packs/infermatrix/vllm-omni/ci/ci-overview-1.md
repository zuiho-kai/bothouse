---
name: ci-overview-1
description: "vLLM-Omni CI 入口（1/2）：何时查 CI 目录，及各测试覆盖边界记录——MiniCPM-o 4.5 full-payload（PR #6745）、dots.tts weekly L4 收集、LTX-2 FP8 quality gate、MiniMax-H3 双卡 FP8 与 H100_2 merge matrix、MiniCPM duplex server-VAD 与 video-frame、FLUX.2 encoder-layer、invalid-request 断言、AutoRound MXFP4、SVDQuant W4A4"
metadata:
  scope: 只收源目录 repos/vllm-omni/ci 根索引页前半的“什么时候查这里 / 不放什么”和按 PR 记录的测试覆盖与证据边界；GGUF、NPU、Qwen-Image、HunyuanVideo、XPU、AMD 边界与目录对照表见 ci-overview-2，规则正文归 ci-rules-1 等规则页
---
# vLLM-Omni CI（1/2）

## 现状

- 拆分说明：本页是源页 `_index.md` 的第 1/2 部分；第 2 部分 [[ci-overview-2]]

### 什么时候查这里

- 处理 vLLM-Omni 的 L2/L4、模型测试配置或 CI 特有问题。
- 处理 `@hardware_test`/`hardware_marks`、SKU 与 `cards_N` 自动 marker 或按卡数切分时，先看 [[test-tiers]]（测试分级与 markers），再按 OMNI-CI-1a 审核 lane 的真实收集与执行。
- Qwen3-TTS Base/CustomVoice 的 ready/merge oracle 与 source dependency 见 [[rules-tts]]（TTS CI 规则）（含 task↔checkpoint 配对与 speaker-embedding miss-EOS retry）。

### MiniCPM-o 4.5 full-payload regression coverage

- PR #6730 had reverted the two PR #5464 CPU assertions after CI failure.PR #6745 reports re-landing them after Buildkite build 14300 passed: with `async_chunk=False`, deployment merge selects Talker’s `tts2code2wav_full_payload`;
  - and a terminal `pooling_output=None` full payload returns an empty terminal packet (`code_flat_numel=0`, `left_context_size=0`, `last_chunk=True`, and `finished=True`) rather than `None`, releasing the downstream consumer wait gate.
- This commit modifies only those two tests. It refreshes regression coverage for existing behavior; it does not itself change runtime, offline-inference, online-serving, or transport implementation. ^[PR #5464] ^[PR #6730] ^[PR #6745]

### dots.tts weekly L4 collection boundary

- Weekly TTS L4 selects `slow and L4 and tts` with `--run-level full_model`; the three dots.tts offline cases carry `slow`, `tts` and one-card L4 hardware markers, so collection returns three.
  - The distinct nightly selector `full_model and L4 and tts` returns zero because these cases do not carry the `full_model` tier marker.
  - PR #6174 reports collection only and explicitly did not run the tests on L4; this records OMNI-CI-1a/1c wiring, not a hardware pass or runtime/model validation. ^[PR #6174]

### LTX-2 FP8 quality-gate recipe boundary

- The H100 full-model `fp8_ltx2` gate compares Lightricks/LTX-2 online FP8 with BF16 using the supported eager default recipe: 512×384, 73 frames, ten steps, seed 42, recipe-default negative conditioning, and no request `sigmas` or `guidance_scale` override.
  - Both arms keep `enforce_eager=True`, so the LPIPS ≤ 0.20 threshold isolates quantization rather than compile behavior.
  - A CPU capturing test must assert that an absent negative prompt is omitted from the request and that the sampling overrides remain `None`; the skipped gate was restored because downstream RL training still relies on LTX-2.
- The PR reports one H100 run (LPIPS 0.0418, PSNR 33.0941 dB, MAE 0.017016) for that exact case. It supports this gate's threshold, not a quantization implementation change, graph-mode parity, other LTX variants, or a broader quality claim. ^[PR #5831]

### MiniMax-H3 two-GPU FP8 quality-test initialization boundary

- The full-model CUDA quality test shares one `common_kwargs` mapping between its fused BF16 baseline and transformer-FP8 candidate: `enforce_eager=True`, `tensor_parallel_size=2`, `text_encoder_tp_size=2`, and VAE tiling.
  - On the exact two-card H100-80GB scope, encoder TP is required for the fused BF16 baseline to initialize; without it, rank 0 retains the full colocated text encoder and can OOM before the FP8 comparison begins.
- This restores a CI test topology/resource setting only.The author reported one local two-B300 run at the stated H100-marked selection, but no completed H100-80GB Buildkite result is recorded here; therefore it does not establish an H100 pass, a result on other hardware, a broader memory bound,
  - or a runtime/quantization implementation change. ^[PR #6742 / issue #6735]

### MiniMax-H3 H100_2 merge matrix

- FL2VA/Ref2VA DP2、Turbo 与 FastH3 由四个 spawn-isolated pytest processes 组成；精确 topology、timeout 与仅限 media-container 的 assertions 见 [[rules-deployment-2]]（MMH3-3m；源锚点 #mmh3-3m-h100_2-merge-lane-只覆盖精确-h3-ci-matrix）。^[PR #6556]

### MiniCPM native-duplex server-VAD coverage

- Ready/merge 的 MiniCPM duplex source dependencies 纳入 server-VAD runner；其 L4 full-model acceptance 验证 one hard-cancel terminal、无旧 epoch delta、speech edges、interrupt PCM/pre-roll 与 follow-up response。它是 protocol/lifecycle coverage，不能单凭 runner 或历史 H200 结果声称常规 listen-only 性能提升。 ^[PR #6170]

### MiniCPM Realtime video-frame unit coverage

- PR #6404 adds CPU/unit coverage for closing-append frame placement, held last/still frames, two-frame stacking, Stage 0 marker/embedding ordering, rejected early video appends, dtype conversion, and external WAV video demos.
  - It is protocol and input-assembly coverage; its unchecked full-model video E2E and manual demo do not establish an end-to-end checkpoint pass or video quality result. ^[PR #6404]

### FLUX.2 configurable encoder-layer test boundary

- `tests/model_tests/diffusion/diff_model_builders.py::tiny_flux2_builder` makes the fixture economical by reducing the text encoder to three layers and selecting `[0, 1, 2]`; its transformer `joint_attention_dim=96` matches the concatenated selected hidden outputs.
  - The focused offline `Flux2Pipeline` run covers text-to-image, determinism, and multi-output. It does not execute a full-size legacy checkpoint without `text_encoder_out_layers`, so it is not evidence that the `(10, 20, 30)` fallback completed a full-model validation. ^[PR #6390]

### 不放什么

- 跨仓库通用的测试方法。

### Invalid-request error expectation

- 对 Qwen3-Omni 的 incomplete `response_format={"type": "json_schema"}`，DFX invalid-request test 应断言 400 公共 API error envelope 中的 `BadRequestError`、`param="response_format"` 和 `json_schema` 缺失提示；不要把 vLLM 内部 validator 的 Pydantic `value_error` token 当成该接口合同。
  - 该断言曾因上游错误映射改为 `BadRequestError` 而导致 weekly CI 失败。^[PR #6290 / issue #6248]

### AutoRound MXFP4 coverage boundary

- Wan AutoRound MXFP4 has a CPU-marked configuration/layer-mapping test and a full-model diffusion E2E test gated to XPU B60. The latter uses an environment-overridable model ID, runs a minimal 256×256 five-frame, one-step request, and checks response success, frame shape, and nonzero variance.
  - It is an offline inference smoke, not online-serving, FLUX, CUDA, or general backend coverage. ^[PR #5544]

### SVDQuant W4A4 coverage boundary

- The SVDQuant suite is CPU-marked and uses mocked NVFP4 kernels to check configuration, tensor conversion, the BF16 correction calculation, and Column/Row/QKV TP loading.
  - It does not run a compatible real kernel, load a released checkpoint, or establish SM103 execution, output quality, latency, or VRAM results. Any GPU support or performance claim requires a separately recorded exact-device E2E run. ^[PR #6162]

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, ci；created: 2026-07-10；updated: 2026-10-06
- 来源（sources）：.buildkite/cuda/pipeline.yml；docs/contributing/ci/test_system_overview.md；tests/diffusion/quantization/test_svdquant_config.py；tests/diffusion/quantization/test_svdquant_linear.py；tests/diffusion/quantization/test_svdquant_tp_loading.py
  - tests/diffusion/quantization/test_wan_autoround_mxfp4.py；tests/e2e/offline_inference/test_wan21_autoround_mxfp4.py；PR #5544；PR #6162；PR #6170；PR #6303；PR #6390；PR #6613；.buildkite/cuda/test-nightly.yml；tests/e2e/online_serving/run_minicpmo_realtime_duplex_server_vad.py
  - tests/e2e/online_serving/test_minicpmo_4_5_duplex_expansion.py；tests/e2e/online_serving/test_qwen_image_expansion.py；tests/dfx/perf/tests/test_qwen_image_vllm_omni.json；tests/platforms/npu/test_diffusion_attn_backend_selector.py；PR #6054；.buildkite/cuda/test-merge.yml
  - .buildkite/cuda/test-ready.yml；tests/e2e/online_serving/test_hunyuan_video_15_expansion.py；tests/dfx/perf/tests/test_hunyuanvideo15_t2v_vllm_omni.json；tests/dfx/perf/tests/test_hunyuanvideo15_i2v_vllm_omni.json；PR #6349；.buildkite/amd/scripts/bootstrap-amd-omni.sh
  - .buildkite/amd/test-amd-merge.yml；.buildkite/amd/test-amd-ready.yml；tests/diffusion/distributed/test_tensor_parallel.py；tests/diffusion/offloader/test_diffusion_layerwise_offload.py；tests/helpers/clean.py；PR #6704；tests/model_executor/models/minicpmo_4_5/test_pipeline.py
  - tests/model_executor/stage_input_processors/test_minicpmo_4_5_async_chunk.py；PR #5464；PR #6730；PR #6745；PR #6727；tests/diffusion/quantization/test_quantization_quality.py；PR #5831；tests/dfx/perf/tests/test_qwen3_omni_async_chunk.json
  - tests/dfx/perf/tests/test_qwen3_omni_no_async_chunk.json；PR #6743；tests/diffusion/models/minimax_h3/test_minimax_h3_quantization_quality.py；PR #6742；PR #6650；pyproject.toml；tests/helpers/mark.py；tests/helpers/tests/test_mark.py；tools/pre_commit/check_test_marks.py；PR #6174
  - .buildkite/cuda/test-weekly.yml；tests/e2e/offline_inference/test_dots_tts_expansion.py；PR #6556；tests/e2e/online_serving/minimax_h3/
