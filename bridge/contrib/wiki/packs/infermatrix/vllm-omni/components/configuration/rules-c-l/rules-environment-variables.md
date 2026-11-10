---
name: rules-environment-variables
description: 规则 VLLM-OMNI-PR9374-CODE2WAV-TEST-SYNC：新增 PUBLIC_OMNI 清单变量（VLLM_OMNI_CODE2WAV_WATCHDOG_TIMEOUT_S）须同 PR 把 test_inventory_matches_reviewed_snapshot_counts 的 expected 从 33 调到 34；MiniCPMO45Code2Wav forward 测试桩须带 _watchdog=Code2WavWatchdog()
metadata:
  scope: "只收 PR #9374 的环境变量清单快照计数与 MiniCPM Code2Wav 测试桩同步一条规则；环境变量 consumer、分类和公开合同的通用规则（VOMNI-CFG-3a）归 configuration-rules-3，变量合同说明归 environment-variable-contract"
---
# vLLM-Omni 配置：环境变量清单与测试同步规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-environment-variables.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-10-26；updated: 2026-10-26
- 来源（sources）：PR #9374
- [VLLM-OMNI-PR9374-CODE2WAV-TEST-SYNC] 新增 PUBLIC_OMNI 清单变量须同 PR 更新快照计数；MiniCPM forward 测试桩须携带 _watchdog
  - 触发：PR 向 `ENVIRONMENT_VARIABLE_INVENTORY` 新增 `EnvironmentVariableCategory.PUBLIC_OMNI` 类环境变量（如 #9370 新增的 `VLLM_OMNI_CODE2WAV_WATCHDOG_TIMEOUT_S`）；或改动 `MiniCPMO45Code2Wav` 的 watchdog 契约（`__init__` 建立的 `_watchdog` 属性或 `forward()` 对它的读取）；
    - 或改动 `tests/config/test_environment_variables.py::test_inventory_matches_reviewed_snapshot_counts`、`tests/model_executor/models/minicpmo_4_5/test_cuda_graph_wrapper.py::test_vocoder_restores_tf32_policy`。
  - 强制：`test_inventory_matches_reviewed_snapshot_counts` 以 `Counter` 按类别统计清单条目并与 expected 字典精确比对，docstring 即 “Make an inventory expansion an explicit review decision”；
    - 因此新增 PUBLIC_OMNI 条目的 PR 必须在同一 PR 内同步上调 expected 中该类计数——#9370 新增 `VLLM_OMNI_CODE2WAV_WATCHDOG_TIMEOUT_S` 使实际计数变为 34，AMD build #14633 以 34 vs 33 失败，PR #9374 将 expected 从 33 补到 34，同步不得留给 CI 红灯后的补丁 PR。
    - `test_vocoder_restores_tf32_policy`（fail=True/False 两个参数化）以 `SimpleNamespace` 桩替身调用 `MiniCPMO45Code2Wav.forward()`，#9370 之后 `forward()` 读取 `_watchdog`，
    - 故该桩须在已解析的 `_tf32_mode` 之外携带 `_watchdog=Code2WavWatchdog()`（导入自 `vllm_omni.model_executor.models.minicpmo_4_5.code2wav_watchdog`；PR #9374 记录该默认构造与 `__init__` 建立的状态一致、不启动监控线程）。评审触发范围内的 PR 时须核对这两处测试假设已随契约变更一并更新。
  - 验收：新增 PUBLIC_OMNI 条目或改动 watchdog 契约的 PR tip 上，`test_inventory_matches_reviewed_snapshot_counts` 的 PUBLIC_OMNI expected 计数与清单实际条目数一致（PR #9374 时点为 34）；
    - `pytest -q tests/config/test_environment_variables.py::test_inventory_matches_reviewed_snapshot_counts` 与 `pytest -q tests/model_executor/models/minicpmo_4_5/test_cuda_graph_wrapper.py::test_vocoder_restores_tf32_policy` 均通过；
    - TF32 策略测试的桩同时含 `_tf32_mode` 与 `_watchdog=Code2WavWatchdog()`。^[PR #9374]

## 决策与踩坑

- [VLLM-OMNI-PR9374-CODE2WAV-TEST-SYNC] 禁止：在未同步 PUBLIC_OMNI expected 计数的情况下合并新增该类清单条目的 PR，或把计数同步推迟到 CI 失败后的后续 PR；在 `test_vocoder_restores_tf32_policy` 的桩中遗漏 `_watchdog`（CUDA READY #18082 与 AMD #14634 两个参数化失败的原因）。
