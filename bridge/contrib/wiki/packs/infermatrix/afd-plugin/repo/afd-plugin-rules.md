---
name: afd-plugin-rules
description: AFD plugin 仓库规则 AFD-1a…AFD-4d：仓库身份和权威来源、上游兼容和历史证据边界、connector/worker/平台 review、验证和证据
metadata:
  scope: 只收 vllm-project/afd-plugin 仓库级规则（AFD-1*、AFD-2a/2e、AFD-3c…3i、AFD-4*）；插件入口与 patch 的细化规则归 plugin-boundary-rules 和 compatibility-rules，初始化与 E2E 门禁归 afd-plugin-rules-init
---
# AFD plugin 仓库规则

## 现状

- 只在当前任务明确属于 `vllm-project/afd-plugin` 时应用本页。
- 先按 [[afd-plugin-overview]]（AFD 入口）确认仓库身份，再结合 [[components-overview]]（组件 owner）读取最近专项页面。
- 插件入口与 patch 的细化规则已分别路由到 [[plugin-boundary-rules]]（plugin-boundary rules）和 [[compatibility-rules]]（compatibility rules）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: afd-plugin, review, config, distributed, model-executor；created: 2026-08-05；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:AGENTS.md
  - afd-plugin@a432692:README.md
  - afd-plugin@a432692:pyproject.toml
  - afd-plugin@a432692:afd_plugin/v1/worker/npu/mla_graph.py
  - afd-plugin@a432692:tests/unit/v1/worker/test_npu_mla_graph.py
  - afd-plugin@a432692:.github/workflows/cpu-only-ci.yml
  - afd-plugin@a432692:.agents/skills/run-e2e/SKILL.md

### 1. 仓库身份和权威来源

- [AFD-1a] AFD-1a：review 或 issue 回答前必须确认目标是 canonical `vllm-project/afd-plugin`，不能把 vLLM-Omni 的知识树、模型规则、远端策略或 rebase 假设带入 AFD。
- [AFD-1b] AFD-1b：AFD 仓库自己的 `AGENTS.md`、`CLAUDE.md`、`.agents/skills/run-e2e/SKILL.md`、CI workflow 和仓库脚本是权威来源；InferMatrixCopilot 只做只读路由、提示和证据组织。
- [AFD-1c] AFD-1c：默认路径保持只读；不能自动发 PR 评论、push、改 protected branch，不能要求 AFD runtime 行为因为本 adapter 初始化而改变。

### 2. 上游兼容和历史证据边界

- [AFD-2a] AFD-2a：兼容结论必须精确写当前声明的 runtime：vLLM `0.26.0`；Ascend NPU 以 vLLM-Ascend source commit `80d8c194f` 及与该 snapshot 匹配的 CANN/torch/torch-npu 环境为证据。
  - 仓库未声明 released vLLM-Ascend v0.26 package/container，不得推断更宽版本范围。
- [AFD-2e] AFD-2e：当前 DeepSeek-V3.2 NPU PCP8 recipe 是 `v0.19.1rc1` 历史实验，不是 v0.26 启动样例；不得把旧 recipe、旧镜像或 PCP 部署当作 v0.26 model-runner-v1 支持证据。

### 3. Connector、worker 和平台 review

- [AFD-3c] AFD-3c：`afd_plugin/connectors/`、`afd_plugin/distributed/` 改动必须审 rank 布局、attention/ffn 数量约束、同步/异步语义、端口/host、进程组生命周期、资源 cleanup 和跨 role 同步失败路径。
- [AFD-3d] AFD-3d：`afd_plugin/v1/worker/`、`afd_plugin/model_executor/` 改动必须审自动 worker 选择、role-specific runner、Attention/FFN 组件加载边界、scheduler-driven FFN fail-fast、CUDA/ACL graph 模式和 DBO/ubatch 条件。
- [AFD-3e] AFD-3e：`csrc/gpu/`、`csrc/npu/` 改动必须区分 CUDA 与 Ascend CANN/ACLNN toolchain；NPU op 构建只能在明确 Ascend 环境或显式 `AFD_BUILD_ASCEND_OPS=1` 下作为证据。
- [AFD-3f] AFD-3f：CUDA `P2pNcclAFDConnector` 只允许 eager 或 `FULL_DECODE_ONLY` CUDA Graph；原生 DBO 只允许两个 ubatch。
  - 改 graph/DBO 路径时必须证明 Attention 控制面先传 stage metadata、FFN graph key/cache 与 connector state 在 capture/replay 中一致，其他组合必须在运行前拒绝。
- [AFD-3g] AFD-3g：Ascend `CAMP2pAFDConnector` 只允许 eager 或 `FULL_DECODE_ONLY` ACL Graph；原生 DBO 只允许两个 ubatch，common 和 connector-local `compute_gate_on_attention` 都必须为 `false`，`quant_mode` 必须为 `0`，并且运行前必须存在 plugin CANN ops。
- [AFD-3h] AFD-3h：Ascend `CAMAsyncAFDConnector` 只支持 eager prefill；必须拒绝 vLLM 原生 DBO。
  - 可选 `async_moe_ubatching` 是独立的两阶段 request-boundary pipeline，不得当作原生 DBO；当前 v0.26 硬件声明只覆盖 no-PCP `2A2F` DeepSeek-V2-Lite，且要求 `async=true`、common `compute_gate_on_attention=true`、`dynamicQuant` 为 `0` 或 `1`。
- [AFD-3i] AFD-3i：Ascend MLA + 原生 DBO Full Graph 修改必须同时保持两个 ubatch、`FULL_DECODE_ONLY` 和禁用 speculative decoding 的门禁；每个 stage 独立捕获 `GraphParams`，回放前按 layer-major/stage-minor 合并，AFD 上下文外必须回退到上游 resolver。

### 4. 验证和证据

- [AFD-4a] AFD-4a：CPU-safe 默认检查是 `uv run pytest`、`uv run pytest -q tests/unit -m "not gpu and not vllm_runtime"`、`uv run ruff check .`、`uv run ruff format --check .`；它们不能证明 GPU/NPU runtime、模型精度或性能。
- [AFD-4b] AFD-4b：GPU/NPU E2E 必须通过 AFD 仓库 `.agents/skills/run-e2e/SKILL.md` 或仓库测试入口运行，记录 backend、设备数、模型路径、vLLM/vLLM-Ascend/CANN/torch 版本、拓扑、connector、graph/DBO/async 配置和 skipped 原因。
- [AFD-4c] AFD-4c：性能、精度或硬件支持 claim 必须给可复现证据：硬件型号、软件版本、driver/toolchain、rank 拓扑、命令、日志或 pytest node id；CPU import/config smoke 不能替代硬件证据。
- [AFD-4d] AFD-4d：changed files 没有命中 adapter route 时，必须把 unmatched path 明确留给 host reviewer 继续人工审，不得把它当作已覆盖。
