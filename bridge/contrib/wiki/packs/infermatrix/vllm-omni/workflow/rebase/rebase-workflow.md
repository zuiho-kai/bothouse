---
name: rebase-workflow
description: Rebase 工作流：对齐分支 dev/vllm-align 与 Buildkite 管线、Wave 1/Wave 2 模块波次、模块到 upstream vLLM 路径映射表、test→module 失败路由、mrv2 外部活文档登记，upstream baseline v0.31.0 @ db9527a468
metadata:
  scope: 只收 upstream 对齐的分支、波次、路径映射与失败路由；具体 API 漂移修法归 upstream-api-drift 与 upstream-api-drift-loading-1、upstream-api-drift-loading-2，目录入口归 rebase-overview
---
# Rebase 工作流：分支、波次与失败路由

## 关键事实

- 源页：`knowledge/repos/vllm-omni/rebase/workflow.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, rebase；created: 2026-07-16；updated: 2026-10-13
- 来源（sources）：PR #6606；PR #8459；vllm-omni-rebase-agent@122a9468:agent/config.py；vllm-omni-rebase-agent@122a9468:config.sh；.buildkite/cuda/rebase-pipeline.yml；docker/Dockerfile.ci
- 运营事实来自 rebase-agent 配置快照（@122a9468，**可能漂移**）；仓库侧事实在 `main @ 19da2382` 复核。运营系统以 rebase-agent 仓库为准，本页是知识树快照；upstream release baseline 为 `v0.31.0 @ db9527a46873454610df6dbedf79a36d6bf1a7f6`（v0.28/v0.29/v0.30/v0.31 各轮 rebase 均已合入，v0.31 为 PR #8459）。^[PR #8459]

### 分支与管线

- 对齐分支 `dev/vllm-align`（目标合回 `main`）；专用 Buildkite 管线 `.buildkite/cuda/rebase-pipeline.yml`（仓库侧）+ 运营管线 `vllm-omni-rebase`（nightly 与 main CI）、`vllm-omni-release`（CI），org `vllm`；wheel 变体 `cu130`；
  - v0.31 轮的 vLLM pin 是 tag `v0.31.0` 的 `db9527a468734`，v0.32 轮（对齐 upstream main，发布分支 cut 出前）改为 commit-pinned nightly wheel（`VLLM_PRECOMPILED_WHEEL_COMMIT`）。CUDA/CI/ROCm base image 和安装文档须同步使用同一 release；只有对齐未发布 SHA 时才启用额外 wheel reinstall/ABI repair。^[PR #6606]
- nightly 循环：定时 nightly 跑对齐分支全量套件；注意定时 nightly 与 API build 的互杀陷阱（[[ci-environment-gotchas-1]]、[[ci-environment-gotchas-2]]（ci-environment-gotchas） 第 3 条）。

### 模块波次（launch waves）

- **Wave 1（并行）**：`worker_runner`、`model_executor`、`input_output`、`scheduler`、`online_serving`、`model_config`、`platform`（重模块先行；worker_runner 与 upstream 集成最深）。
- **Wave 2（wave 1 之后）**：`benchmarks`（依赖其他模块的 API）。
- `ALL_MODULES` = Wave 1 + Wave 2 合并（config.sh 与 config.py 双处定义）。^[CFG-waves]

### 模块 → upstream vLLM 路径映射

| 模块 | upstream 关注路径 |
|---|---|
| model_config | `vllm/config/`、`vllm/engine/arg_utils.py` |
| input_output | `vllm/inputs/`、`vllm/v1/engine/{input_processor,output_processor}.py`、`vllm/v1/request.py` |
| scheduler | `vllm/v1/core/sched/` |
| worker_runner | `vllm/v1/worker/` |
| model_executor | `vllm/model_executor/` |
| online_serving | `vllm/entrypoints/` |
| benchmarks | `vllm/benchmarks/`、`vllm/entrypoints/cli/benchmark/` |
| platform | `vllm/platforms/` |

- rebase 前按该映射扫 upstream 变更（`git log` 对应路径），漂移模式对照 [[upstream-api-drift]]（upstream-api-drift） 两页。^[CFG-module-paths]

### 失败路由（test → module）

- 运营侧按 test slug → 模块 的映射路由失败（config.sh 的 `CI_TEST_MODULE` 等伴随表：slug → label/source/cmd/hw/timeout/module），失败先归模块、再进对应组件 owner 页；分级与队列见 [[test-tiers]]（ci/test-tiers） 与 [[buildkite-structure]]（ci/buildkite-structure）。

### 活文档（外部登记册，只链接）

- `vllm-omni-mrv2-rebase-plan.md`（/rebase 顶层）：Model Runner V2 对齐计划—— upstream 破坏性 API 变更登记（PPHandler、dispatch_cg_and_sync_dp、postprocess_sampled、KVConnector.post_forward 签名等）、依赖 import 清单、execute_model/sample_tokens 需保留的 7 项 Omni 行为、风险登记与 31 个上游 model_runner.py 提交的风险分级。^[DOC-mrv2-plan]
- `vllm-mrv2-commits-since-v0.20.0.md`：v0.20.0..78743ab 的 MR V2 主题化提交变更册（架构/CUDA Graph/spec decoding/采样/分布式/多模态/CI）。^[DOC-mrv2-commits]
- 两份均为**外部活文档**（会更新），知识树只登记入口与用途，不复制正文；快照（含 sha256）存于 copilot 仓库 `doc/archive/reorg-audit/enrichment-baseline/`。

### 相关

- 漂移修法：[[upstream-api-drift]]（serving/调度/测试侧）、[[upstream-api-drift-loading-1]]、[[upstream-api-drift-loading-2]]（加载/运行时侧）；golden 重基线政策见 [[accuracy-attribution]]（ci/accuracy-attribution）。
