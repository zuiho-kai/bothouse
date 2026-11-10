---
name: test-tiers
description: 测试分级 L1–L5 与 pytest markers：五级的范围、marker（core_model / advanced_model / full_model）、触发和目录对照表，pyproject.toml 定义的分级、领域、平台、硬件（cards_N、hardware_test / hardware_marks）markers
metadata:
  scope: 只收 vLLM-Omni 测试金字塔五级定义和 pytest marker 分类及其自动派生方式；各级到 Buildkite 子管线的映射归 buildkite-structure，硬件 lane 审查规则归 ci-rules-1 等规则页
---
# 测试分级（L1–L5）与 pytest markers

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/guides/test-tiers.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, ci；created: 2026-07-16；updated: 2026-09-05
- 来源（sources）：docs/contributing/ci/test_system_overview.md；docs/contributing/ci/test_writing_guide.md；PR #6650
- 官方 spec：`docs/contributing/ci/test_system_overview.md` + `test_writing_guide.md`（`v0.26.0 @ a4ea67a2` 复核）。测试金字塔五级 + Common 规范（PR 模板/checklist 与 CI 失败说明）。

### 五级定义

| 级别 | 范围 | marker | 触发 | 目录 |
|---|---|---|---|---|
| L1 | 单元/逻辑（CPU，<15min） | `core_model and cpu` | 每个带 `ready` label 的 PR | `tests/<component>/test_*` |
| L2 | 高优模型 E2E + 需 GPU 的单测（请求成功/输出非空/格式对——**不含精度**） | `core_model` | `ready` PR / main+nightly | `tests/e2e/...` |
| L3 | 进阶模型 E2E | `advanced_model` | 每次 merge 到 main | `tests/e2e/...` |
| L4 | 全量模型：功能 + 性能 + 精度 + 文档示例 | `full_model` | nightly（或 PR label + rebuild） | `tests/e2e/`、`tests/dfx/perf/`、doc example 测试 |
| L5 | 长期稳定性 | — | weekly | `tests/dfx/stability/` |

- 与仓库硬门禁的对应（[[vllm-omni-rules-1]]、[[vllm-omni-rules-2]]、[[vllm-omni-rules-3]]（rules.md））：**L2 只许 CPU/mock 功能、不得触发真实 stage/device/GPU 初始化；真实权重、精度、性能与 profiling 属 L4**。

### markers（pyproject.toml 定义）

- 分级：`core_model`（L1&L2）、`advanced_model`（L3）、`full_model`（L4）。
- 领域：`diffusion`、`omni`、`tts`、`cache`、`parallel`。
- 平台：`cpu`、`gpu`、`cuda`、`rocm`、`xpu`、`npu`。
- 硬件：SKU 与 `cards_N` card-count markers 均由 `pyproject.toml` taxonomy/`hardware_test` 或 `hardware_marks` 派生（default `cards_1`）；Buildkite 按 `cards_N` 分区。handwritten SKU marks 由 `check-mark` pre-commit 拒绝；这是 collection/routing contract，不是 runtime claim。^[PR #6650]
- 其他：`slow`（快速 CI 可跳）、`benchmark`。
- 带 `*` 的平台/硬件/分布式/skipif markers 由 `@hardware_test` 参数化装饰器（或 `hardware_marks`）**自动添加**，用法：`@hardware_test(res={"cuda": "L4", "rocm": "MI325", "npu": "A2"}, num_cards=2)`。

### 相关

- 各级怎样映射到 Buildkite 管线见 [[buildkite-structure]]（buildkite-structure）；仓库配置坑见 [[ci-gotchas]]（ci-gotchas）。
