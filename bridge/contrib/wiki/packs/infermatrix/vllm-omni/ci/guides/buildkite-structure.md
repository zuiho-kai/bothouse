---
name: buildkite-structure
description: Buildkite 管线结构：.buildkite/ 布局（cuda/pipeline.yml 上传子管线、L2–L5 到 test-ready/merge/nightly/weekly 的映射、平台与 AMD 管线、测试树归档、l4_1..4 Kubernetes presets）和 rebase-agent 观测的运营事实（org vllm、vllm-omni-release / vllm-omni-rebase、队列映射）
metadata:
  scope: 只收 vLLM-Omni 仓库 .buildkite/ 目录布局与分级到子管线的映射，以及管线名、队列到硬件映射这类运营观测；分级和 marker 定义归 test-tiers，L4 Kubernetes 资源与 shard 合同归 rules-l4-k8s，skipped-build/rebuild 互杀归 ci-environment-gotchas-2
---
# Buildkite 管线结构

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/guides/buildkite-structure.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, ci；created: 2026-07-16；updated: 2026-09-05
- 来源（sources）：PR #6890；.buildkite/cuda/pipeline.yml；.buildkite/cuda/rebase-pipeline.yml；.buildkite/common/ci_mirror_hardwares.yml；.buildkite/cuda/test-ready.yml；.buildkite/cuda/test-nightly.yml；.buildkite/cuda/test-weekly.yml；vllm-omni-rebase-agent@122a9468:agent/config.py
  - vllm-omni-rebase-agent@122a9468:config.sh
- 仓库侧事实在 `v0.26.0 @ a4ea67a2` 复核；运营侧事实（管线名、队列→硬件映射）来自 rebase-agent 配置快照（@122a9468），**属运营观测、可能漂移**，用前核对。

### `.buildkite/` 布局（仓库侧）

- **`cuda/pipeline.yml`**（CUDA hook entry）：由 `.buildkite/common/scripts/upload_pipeline.py` 读取 `cuda/bootstrap-upload-steps.yml` 并上传实际子管线；skip-ci 的 step key 是 `upload-ci-pipeline`，不再依赖根目录 `pipeline.yml` 的 two-doc 结构。
- 分级 → 子管线映射：**L2 → `test-ready.yml`**（带 `ready` label 的 PR，diff-aware；或 main+nightly）；**L3 → `test-merge.yml`**（`merge-test` label 或 main+nightly）；**L4 → `test-nightly.yml`**（main+nightly 定时，或 PR label + rebuild）；**L5 → `test-weekly.yml`**（每周，依赖镜像构建）。
- 平台管线：`intel/pipeline-intel.yml`、`npu/pipeline-npu.yml`、`npu/pipeline-npu-a3.yml`；AMD 变体 `amd/test-amd-ready.yml`/`test-amd-merge.yml` + `test-template-amd-omni.j2` + bootstrap 脚本；发布/对齐：
- `release/release-pipeline.yml` 是发布管线；对齐管线现在是 `cuda/rebase-pipeline.yml`，分别上传 ready、merge 和 nightly 子管线。
- 测试树按 owner/feature 归档：原 `tests/ar_diffusion/` 归入 `tests/diffusion/ar_diffusion/`，full-duplex、custom pipeline、RLHF 和 ComfyUI 归入 `tests/e2e/features/<feature>/`；新增 component 测试放在对应 `tests/{component}/`，不创建平行的旧顶层目录。
- `cuda/test-ready.yml` 的 CPU fast lanes 仍按 `tests/diffusion`、`tests/model_executor`、`tests/entrypoints` 和 `tests/engine` 分组；L4 GPU jobs 已按 `cards_N` 投影到 `l4_1..4` Kubernetes presets，而不是旧 `gpu_1_queue`/`gpu_4_queue` Docker lanes。
  - 精确资源、retry 与 ready/nightly/weekly shard 合同见 [[rules-l4-k8s]]（OMNI-CI-1e）。

### 运营事实（rebase-agent 观测，@122a9468）

- Buildkite org：`vllm`。管线：`vllm-omni-release`（CI）、`vllm-omni-rebase`（nightly 与 main CI）；rebase 分支 `dev/vllm-align`，wheel 变体 `cu130`，上次 rebase 的 vLLM 提交 pin `1acd67a795ebccdf9b9db7697ae9082058301657`。^[CFG-buildkite]
- 旧 rebase-agent 快照中的 `gpu_1_queue`/`gpu_4_queue` 是历史运营映射，不能描述当前仓库 L4 job；当前 repo-side `l4_1..4` 使用 `l4-k8s` 和 `vllm.ci/gpu-pool=l4x4`。H100/H800 的 `mithril-h100-pool` 仍是外部运营观测，使用前必须复核。^[CFG-queue-map] ^[PR #6890]

### 相关

- 分级定义见 [[test-tiers]]（test-tiers）；Buildkite skipped-build/rebuild 互杀等环境坑见 [[ci-environment-gotchas-1]]、[[ci-environment-gotchas-2]]（ci-environment-gotchas）；rebase 管线的工作流见 [[rebase-overview]]（rebase 主题）。
