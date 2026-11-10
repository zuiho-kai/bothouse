---
name: ci-rules-1
description: vLLM-Omni CI 规则（1/3）来源清单与 Direct 代码快速入口表：PR 描述信号到 OMNI-CI-1a…4a 规则及第一批源码（.buildkite、upload_pipeline.py、tests/helpers、tests/dfx）的对照
metadata:
  scope: 只收 ci/rules.md 的页首说明、sources 清单和按 PR 信号选规则的入口表；规则正文见 ci-rules-2 和 ci-rules-3，并行测试与 engine fixture 规则归 rules-test-fixtures，AMD/ROCm 归 rules-amd，TTS 归 rules-tts
---
# vLLM-Omni CI 规则（1/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/3 部分；第 2 部分 [[ci-rules-2]]；第 3 部分 [[ci-rules-3]]
- 源页：`knowledge/repos/vllm-omni/ci/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, ci；created: 2026-08-23；updated: 2026-10-06
- 来源（sources）：PR #8459；PR #7648；PR #3422；PR #5074；PR #5255；PR #5310；PR #5402；PR #5524；PR #5543；PR #5670；PR #5713；PR #5780；PR #5823；PR #5836；PR #5957；PR #5976；docker/Dockerfile.ci；docker/Dockerfile.xpu；.buildkite/intel/scripts/run-xpu-test.sh；.buildkite/cuda/test-merge.yml
  - .buildkite/cuda/test-ready.yml；PR #5845；PR #5872；PR #6008；PR #6048；PR #6056；PR #6096；PR #6102；PR #6202；PR #6208；PR #6273；PR #6293；PR #6311；PR #6339；PR #6343；PR #6468；PR #6523；PR #6613；PR #6555；PR #6650；.buildkite/common/scripts/run_cov_split.sh；pyproject.toml
  - tests/helpers/tests/test_mark.py；tools/pre_commit/check_test_marks.py；.buildkite/common/scripts/upload_pipeline.py；.buildkite/cuda/test-nightly.yml；.buildkite/cuda/test-weekly.yml；.buildkite/npu/test-npu-nightly.yml；.pre-commit-config.yaml；tests/helpers/clean.py
  - tests/helpers/client.py；tests/helpers/mark.py；tests/helpers/runtime.py；tests/helpers/stage_config.py；tests/buildkite/test_upload_pipeline.py；tests/dfx/perf/scripts/run_benchmark.py；tests/dfx/perf/tests/test_minicpmo_4_5.json
  - tests/dfx/perf/tests/test_minicpmo_4_5_duplex_seed_tts.json；tests/dfx/perf/tests/test_qwen_image_vllm_omni.json；tests/dfx/stability/；tests/e2e/accuracy/minicpmo_4_5/test_minicpmo_4_5.py；tests/e2e/online_serving/helpers/minicpmo_4_5_duplex.py
  - tests/e2e/online_serving/test_flux_kontext_expansion.py；tests/e2e/online_serving/test_minicpmo_4_5.py；tests/e2e/online_serving/test_minicpmo_4_5_duplex.py；tests/e2e/online_serving/test_minicpmo_4_5_expansion.py；tests/e2e/online_serving/test_qwen_image_expansion.py
  - tests/e2e/online_serving/test_minimax_h3_dlo_dp2_t2va.py；tests/model_tests/diffusion/diff_model_builders.py；tests/model_tests/diffusion/model_settings.py；tests/model_tests/diffusion/test_alignment.py；tools/nightly/run_nightly_jobs.sh；tools/pre_commit/check_tts_adapter.py
  - tests/tools/test_check_tts_adapter.py；.buildkite/amd/scripts/bootstrap-amd-omni.sh；.buildkite/amd/test-amd-merge.yml；.buildkite/amd/test-amd-ready.yml；tests/diffusion/distributed/test_tensor_parallel.py；tests/diffusion/offloader/test_diffusion_layerwise_offload.py；PR #6704
  - tests/dfx/perf/tests/test_qwen3_omni_async_chunk.json；tests/dfx/perf/tests/test_qwen3_omni_no_async_chunk.json；PR #6743；PR #6696；vllm_omni/benchmarks/metrics/metrics.py；vllm_omni/benchmarks/patch/patch.py；tests/benchmarks/metrics/test_metrics.py；tests/benchmarks/patch/test_patch.py
  - PR #6674；docker/Dockerfile.npu；docker/Dockerfile.npu.a3；docker/Dockerfile.npu.ci；docker/Dockerfile.npu.ci.a3；PR #6818；PR #6830；PR #6884；tests/diffusion/conftest.py；tests/diffusion/attention/test_flash_attn.py；tests/buildkite/test_amd_pipeline.py
  - tests/e2e/offline_inference/test_qwen3_omni_colocate_async.py；PR #6947；PR #7118；PR #6597；PR #7371；PR #7534；PR #8346；PR #8239；PR #8528
- 置信度（confidence）：high
- 只有 `OMNI-CI-数字字母` 是可审计规则 ID。
- 相关专题：[[rules-test-fixtures]]（CI 并行测试与 engine fixture 合同）（`OMNI-CI-2b`, `OMNI-CI-2c`, `OMNI-CI-2d`, `OMNI-CI-2h`）。

### Direct 代码快速入口

| PR 描述信号 | 规则 | 第一批源码 |
|---|---|---|
| Buildkite 失败日志与运行时差异 | `OMNI-CI-4a` | 失败路径对应源码与测试 |
| 新模型、nightly、CUDA/NPU、硬件 marker、镜像升级 | `OMNI-CI-1a` | `.buildkite/**` → `pyproject.toml` markers → 目标 e2e/accuracy test |
| regression/guard、route census、middleware、mutation test | `OMNI-CI-1b` | 公开 app/handler → guard test；先证明旧实现会失败 |
| `NIGHTLY`/`WEEKLY`/`NON_CRITICAL`、L1/L4/L5、coverage、scheduled bootstrap | `OMNI-CI-1c` | `upload_pipeline.py` → bootstrap YAML → ready/merge/nightly/weekly YAML → coverage helper |
| Qwen3-TTS Base/CustomVoice ready/merge collection 或 source dependencies | [[rules-tts]]（OMNI-CI-1d；源锚点 #omni-ci-1d-qwen3-tts-base-的-dummy-ready-oracle-与-real-weight-merge-coverage-必须分离） | CUDA/AMD ready+merge YAML → Qwen3-TTS e2e markers |
| pre-commit、SPDX、shellcheck、stability marker | `OMNI-CI-2a` | `.pre-commit-config.yaml`、`.buildkite/**`、`tools/**` |
| xdist、共享 worker、helper 拆分/启动回滚、下载 fixture、进程池、后台 retry 回归 | `OMNI-CI-2b`、`OMNI-CI-2h` | `tests/conftest.py`、`tests/helpers/{client,clean,runtime,stage_config}.py`、`tests/model_tests/**` |
| 重模型 cold start、共享 engine/server fixture、sleep/wake | `OMNI-CI-2c` | `tests/entrypoints/test_omni_sleep_mode.py`、OmniServer fixture scope/lock |
| diffusion tiny builder、model settings、alignment exclusion、重模型 OOM | `OMNI-CI-2d` | `tests/model_tests/diffusion/{diff_model_builders,model_settings,test_alignment}.py` → common offline tests |
| perf baseline、hardware label、DFX result artifact、assert-baseline | `OMNI-CI-3a` | `tests/dfx/conftest.py`、`tests/dfx/perf/scripts/run_benchmark.py`、`run_diffusion_benchmark.py`、`tests/dfx/perf/tests/**` |
| ASR transcript、文本相似度或词汇归一化 | `OMNI-CI-3d` | `tests/helpers/media.py::{preprocess_text, cosine_similarity_text}` → `tests/helpers/tests/test_media.py` |
| Qwen3-TTS perf/CI task↔checkpoint 配对、Base speaker-embedding miss-EOS retry | [[rules-tts]]（OMNI-CI-3g）、[[rules-tts]]（OMNI-CI-3f） | `tests/dfx/perf/tests/**` TTS JSON → serving validation；`test_qwen3_tts_speaker_embedding` |
| scheduled CUDA mirror secret env、`HF_TOKEN` alias、GPU preset expansion | `OMNI-CI-1f` | `upload_pipeline.py` GPU preset expansion → pod env / step commands |

- （以下为原表格，按行改写为条目）
- PR 描述信号：AMD/ROCm CI timeout、quarantine、diagnostic hang、memory assertion、Qwen3-TTS argv 或 Qwen3-Omni sleep/abort control plane
  - 规则：[[rules-amd]]（OMNI-CI-2f；源锚点 #omni-ci-2f-amd-ci-stabilization-必须保留有界执行与测量信号）、[[rules-amd]]（OMNI-CI-2g）
  - 第一批源码：`.buildkite/amd/**` → `tests/buildkite/test_amd_pipeline.py` / `ci/qwen3_omni_moe_colocate_async.yaml` → target test
