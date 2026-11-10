---
name: rules-amd-ci-2
description: vllm-omni AMD/ROCm CI 规则（下）：VLLM-OMNI-PR9307-QOMNI-SEEDTTS-RT-NIGHTLY（Qwen3-Omni Seed-TTS 实时基准 MI300 夜间单 NonBlocking 作业、Silero VAD 预取、暂无基线）与 VLLM-OMNI-PR9372-AMD-NIGHTLY-SRC-FILTER（PR 夜间只滤 NIGHTLY_TESTS 组的源依赖过滤）
metadata:
  scope: "只收 PR #9307 与 PR #9372 两条 AMD 夜间 CI 规则；R2-01 分片、AITER MHA 缓存、Wan2.2 I2V 夜间精度三条归 rules-amd-ci-1"
---
# vllm-omni AMD/ROCm CI 流水线规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-amd-ci.md` 的第 2/2 部分；第 1 部分 [[rules-amd-ci-1]]
- 源页：`knowledge/repos/vllm-omni/rules-amd-ci.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni；created: 2026-10-22；updated: 2026-10-25
- [VLLM-OMNI-PR9307-QOMNI-SEEDTTS-RT-NIGHTLY] Qwen3-Omni Seed-TTS 实时性能基准进 MI300 夜间：单 NonBlocking 作业、VAD 预取 pin、采集与结果双守卫、MI300 暂无基线
  - 触发：改动 `.buildkite/amd/test-amd-nightly.yml` 中 `Qwen3-Omni Seed-TTS Realtime Perf` 作业（label、`agent_pool`、`grade`、`depends_on`、`mirror_hardwares`、`timeout_in_minutes`、`env`、`artifact_paths` 或 commands），或 `tests/dfx/perf/tests/test_qwen3_omni_seed_tts.json` 的硬件 mark / `benchmark_params`，或删除、
    - 改写 `tests/buildkite/test_amd_pipeline.py::test_qwen3_omni_seed_tts_realtime_perf_is_one_nonblocking_nightly_job` 回归测试。本规则只覆盖 AMD 夜间通道的该作业。
  - 强制：该基准必须是夜间通道的单个 `NonBlocking` 作业：`agent_pool: mi300_2`、`depends_on: amd-build`、`mirror_hardwares: [amdproduction]`、外层 `timeout_in_minutes: 180`，工件根 `artifacts/rocm-qwen3-omni-seed-tts-perf/**/*`（`BENCHMARK_DIR` 指向其 `benchmark-results` 子目录）。
    - 跑测前必须以 `hf_hub_download` 按 `SILERO_VAD_REPO_ID`/`SILERO_VAD_FILENAME`/`SILERO_VAD_REVISION` 预取 Silero VAD 并执行 `SileroVADBackendProvider().get()`。
    - 运行前先 `pytest --collect-only` 落盘 `collection.txt`，断言恰好收集 `test_qwen3_omni_seed_tts_realtime-explicit` 与 `test_qwen3_omni_seed_tts_realtime-vad` 两个节点（总数恰为 2 且逐节点 `grep -F` 命中，否则 exit 5）；运行用内层 `timeout --signal=TERM --kill-after=2m 165m`，pytest 退出码经 `PIPESTATUS` 保留；
    - pytest 成功后仍须核对恰好两份 `result_test_qwen3_omni_seed_tts_realtime_*.json`、文件名含 `_explicit_` 与 `_vad_` 各恰好一份，不符则置失败码 5。选择标记 `-m "full_model and omni and rocm and MI325 and cards_2"` 加 `--run-level full_model`；
    - config JSON 的 `hardware_marks.res.rocm` 为 `MI325`（CUDA `H100`/`B200` 保留），`benchmark_params` 恰为 `explicit`/`vad` 两项且不含 `baseline` 键——MI300 基线留空，作业只记录结果 JSON 供后续 PR 选定 floors。READY 与 MERGE 管道不得出现 `Qwen3-Omni Seed-TTS Realtime Perf`。
  - 验收：`pytest tests/buildkite/test_amd_pipeline.py::test_qwen3_omni_seed_tts_realtime_perf_is_one_nonblocking_nightly_job -q` 通过；夜间 YAML 中该作业保持上述结构，`tests/dfx/perf/tests/test_qwen3_omni_seed_tts.json` 的 rocm mark 为 `MI325` 且 `benchmark_params` 为无 baseline 的 explicit/vad 两项；
    - `test-amd-ready.yml` 与 `test-amd-merge.yml` 不含该作业 label。^[PR #9307]
- [VLLM-OMNI-PR9372-AMD-NIGHTLY-SRC-FILTER] AMD label 夜间按源依赖过滤：只滤 NIGHTLY_TESTS 组，排定/调试夜间逐字节全量
  - 触发：改动 `.buildkite/amd/scripts/filter_test_suite.py`、`.buildkite/amd/scripts/bootstrap-amd-omni.sh` 中 `upload_pipeline` 的夜间过滤接线与临时文件清理、`.buildkite/amd/test-amd-nightly.yml` 作业的 `source_file_dependencies` 键，
    - 或 `.buildkite/common/ci_source_file_dependencies.yml` 与 `.buildkite/common/scripts/upload_pipeline.py` 中 `filter_pipeline_by_source_dependencies` 的共享注册表及 AMD 回退前缀。
  - 强制：label 触发的 AMD PR 夜间（`BUILDKITE_PULL_REQUEST` 非 `false`/空、无 `DEBUG_TEST_YAML`、非 `NIGHTLY=1`）必须经 `filter_test_suite.py` 复用共享 `filter_pipeline_by_source_dependencies`，只保留与 `--changed-files` 匹配的作业；`test-amd-nightly.yml` 每个夜间作业声明 `source_file_dependencies` 键（PR #9372 覆盖全部 30 个工作负载）；
    - 多套件组合时仅过滤 `NIGHTLY_TESTS` 组——组缺失、重复或组内 steps 非列表必须报错，过滤后为空则整组移除——READY/MERGE 组保持原样；排定 `NIGHTLY=1` 与显式调试夜间必须把输入套件逐字节写入输出、不过滤；AMD 复用 CUDA/NPU 的匹配与回退语义但不套用 CUDA 硬件扩展；
    - 路由基础设施文件（bootstrap/combine/filter/select 脚本、`test-template-amd-omni.j2`、依赖注册表、common `upload_pipeline.py`）作为 AMD 回退前缀：改动仅限这些文件时保留全量套件，且回退不豁免过滤——同时存在命中作业依赖键的源码改动时套件仍按匹配收窄（由 `tests/buildkite/test_amd_nightly_source_filter.py::test_fallback_plus_matching_model_change_still_filters` 守护）；
    - fail-closed 范围以 `filter_test_suite.py` 实际捕获的 `FileNotFoundError`/`TypeError`/`ValueError`（依赖键未知、注册表缺失、组合套件缺 steps 列表、`NIGHTLY_TESTS` 组缺失/重复/组内 steps 非列表）及顶层文档非 dict 的 `parser.error` 为限——YAML 解析异常不在捕获之列，共享过滤函数对顶层 steps 非列表的套件按原文档返回，不得把 fail-closed 表述为覆盖一切非法输入；
    - 在 `pipeline.yaml` 渲染并 `cat` 完成后、执行 `buildkite-agent artifact upload pipeline.yaml` 与 `buildkite-agent pipeline upload pipeline.yaml` 之前，清理 combined 与 filtered 两个临时 YAML。
  - 验收：`env PYTHONPATH=. pytest -q -o addopts='' --confcutdir=tests/buildkite tests/buildkite/test_amd_nightly_source_filter.py tests/buildkite/test_upload_pipeline.py` 通过，其中 `test_fallback_plus_matching_model_change_still_filters` 断言回退前缀改动叠加匹配源码改动仍收窄套件；
    - `test-amd-nightly.yml` 每个夜间作业含 `source_file_dependencies`；diffusion-only PR 输入收窄到匹配的 tiny-diffusion 作业，排定与调试输入与原套件逐字节一致，组合 READY+NIGHTLY 输入 READY 原样、仅 NIGHTLY 部分收窄。^[PR #9372]

## 决策与踩坑

- [VLLM-OMNI-PR9307-QOMNI-SEEDTTS-RT-NIGHTLY] 禁止：把该作业改为 Blocking，或把它加入 `test-amd-ready.yml` / `test-amd-merge.yml`；在选定 MI300 基线前给 `benchmark_params` 添加 `baseline` 键；移除 Silero VAD 预取步骤、collect-only 节点守卫或结果 JSON 数量/命名核对；令内层 timeout 不低于外层 180 分钟；改掉 `MI325` mark 或删除 CUDA `H100`/`B200`；
  - 删除该结构回归测试或其中对 READY/MERGE 管道的排除断言。
- [VLLM-OMNI-PR9372-AMD-NIGHTLY-SRC-FILTER] 禁止：让 label 触发的 AMD PR 夜间跳过源过滤扇出全量矩阵（PR #9369 例：diffusion-only PR 在 CUDA 侧只选 2 个源相关作业，AMD 侧却跑满 30 个夜间工作负载）；过滤排定 `NIGHTLY=1` 或调试夜间；过滤组合套件中 `NIGHTLY_TESTS` 以外的组；删除夜间作业的 `source_file_dependencies` 键；对 AMD 套用 CUDA 硬件扩展；
  - 仅因改动同时触及路由基础设施回退前缀就放行全量套件（同时存在匹配源码改动时仍须收窄）；吞掉上述已捕获范围内的 fail-closed 错误令未知键静默放行或静默收窄；删除 `tests/buildkite/test_amd_nightly_source_filter.py` 或 `tests/buildkite/test_upload_pipeline.py` 中对应回归。
