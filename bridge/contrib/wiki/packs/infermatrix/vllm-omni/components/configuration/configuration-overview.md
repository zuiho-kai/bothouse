---
name: configuration-overview
description: vLLM-Omni Configuration 目录入口：vllm_omni/config 与 deploy YAML 的源码、测试路径（main @ 44d3ae10 校验），何时查配置 owner、不放什么，以及按问题指向 architecture、各 rules-* 专题和 guide 页的对照表
metadata:
  scope: 只收 components/configuration 目录的源码锚点、适用范围和内容对照；配置构造现状归 configuration-architecture，门禁规则归 configuration-rules-1 至 configuration-rules-3 及各 rules-* 专题页，HTTP 请求字段归 serving 组件
---
# vLLM-Omni Configuration

## 现状

- 主要源码：`vllm_omni/config/`
- 跨边界入口：`vllm_omni/diffusion/data.py`、`vllm_omni/engine/arg_utils.py`、`vllm_omni/engine/stage_init_utils.py`、`vllm_omni/engine/async_omni_engine.py`
- 主要测试：`tests/config/`、`tests/config/test_config_factory.py`、`tests/diffusion/test_diffusion_config_propagation.py`，以及各公开入口附近的配置测试
- 部署配置：`vllm_omni/deploy/*.yaml`，以及 `pipeline_registry.py`、`endpoint_policy.py`、`server_settings.py`、`yaml_util.py`、`composable_parallel/`
- 源码校验：以上路径在 `main @ 44d3ae10`（upstream `main` 快照）验证存在；机器基线见 `adapters/vllm_omni/release_baseline.yaml`

### 什么时候查这里

- 修改 deploy、pipeline、stage、CLI、默认 factory 或 direct kwargs 的配置构造。
- 调查字段来源优先级、alias、flat→nested、strict unknown-field 校验、shared/stage/diffusion owner 分区。
- 核对 structured、legacy startup、默认 single-stage factory 和 direct factory 的语义一致性。

### 不放什么

- HTTP 请求字段和 serving 层限制；这些属于 [[serving-overview]]（Serving）。
- 最终 stage config 之后的并行与设备启动；这些属于 [[model-executor-overview]]（Model Executor）。
- 某个模型独有的配置或 checkpoint 语义；这些放模型目录。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| API speech_cache budgets、继承与 process-local singleton | [[rules-speech-cache]]（speech cache） |
| 理解配置从 deploy、CLI、默认 factory 到 structured/legacy config 的稳定边界 | [[configuration-architecture]]（配置构造架构） |
| 根据 PR 描述直达 strict schema、pipeline sampling constraints、deploy/topology、composable strategy、global engine args 的 owner 校验、CLI-only 负向 alias 或显存配置的规则组与第一批源码、环境变量 inventory | [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（配置开发门禁与代码地图）   新增核对：CONF-3e。 |

- （以下为原表格，按行改写为条目）
- 遇到什么：对象存储 URI、HF cache snapshot 或空 `config.json` 的模型名称回退与 pipeline 路由
  - 查看哪里：[[rules-model-reference-routing]]（模型引用路由规则）
- 遇到什么：stage full-payload transport capability、topology-owned projection、async-chunk 自动模式或 deploy/CLI override rejection
  - 查看哪里：[[rules-stage-transport]]（stage transport capability）
- 遇到什么：diffusion Ulysses SymmMem transport flag 的 deploy/CLI/default-stage projection
  - 查看哪里：[[rules-diffusion-parallel-transport]]（diffusion parallel transport rules）
- 遇到什么：diffusion attention shorthand、structured config 与 global override 的优先级和最终规范表示
  - 查看哪里：[[rules-diffusion-attention-precedence]]（diffusion attention precedence）
- 遇到什么：legacy stage engine args 的 copy boundary、connector/default injection、repeated build mutation、global engine args 的 owner 校验或 CLI-only 负向 alias
  - 查看哪里：[[rules-legacy-engine-args]]（legacy engine-args isolation）   新增核对：VOMNI-CFG-1u。
- 遇到什么：审计配置来源和多层加工
  - 查看哪里：[[config-audit-plain-language]]（config audit）
- 遇到什么：设计配置归一化与 parity 验证
  - 查看哪里：[[config-normalization-parity]]（config normalization parity）
- 遇到什么：查询 `Omni()` 初始化参数
  - 查看哪里：[[omni-init-args]]（Omni init args）
- 遇到什么：写或修改 deploy YAML
  - 查看哪里：[[deploy-yaml]]（deploy YAML）
- 遇到什么：核对 pipeline/deploy schema
  - 查看哪里：[[pipeline-deploy-schema]]（pipeline deploy schema）
- 遇到什么：审查或新增 process 环境变量、stage `env` 和安全诊断输出
  - 查看哪里：[[environment-variable-contract]]（environment-variable contract）
- 遇到什么：计算多 stage 显存预算
  - 查看哪里：[[deployment-memory-budget]]（deployment memory budget）
- 遇到什么：添加新模型和注册点
  - 查看哪里：[[adding-a-model]]（adding a model）
- 遇到什么：composable strategy、并行拓扑、VAE batch mode 的 WORLD→DP 门禁与 load balancing owner
  - 查看哪里：[[rules-parallel-topology]]（并行拓扑合同）
- （以下为原表格，按行改写为条目）
- 遇到什么：冻结 topology、辅助 stage、mixed V1/MRv2 runner、deploy profile 与 `additional_config` 投影
  - 查看哪里：[[rules-topology-profiles-1]]、[[rules-topology-profiles-2]]（topology 与部署 profile）
- [[rules-platform-overlays]]（部署 platform overlay 的最终配置合同）。
- [[rules-cudagraph-kv-reserve]]（配置规则 — CUDA graph 显存预留与 KV 预算）
- [[rules-xpu-eager-pins]]（XPU eager pins 与 Intel 支持验证）
- [[rules-perf-baseline-derivation]]（性能基准扩档与基线推导规则）
- [[rules-thinker-prefix-cache]]（Thinker prefix cache deploy 默认值）
- [[rules-environment-variables]]（vLLM-Omni 配置：环境变量清单与测试同步规则）
- [[rules-engine-args]]（vllm-omni 配置 · engine args 评审规则）
- [[rules-compile-hash]]（Torch Compile Hash 稳定性与模型侧编译日志规则）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, components, config；created: 2026-07-16；updated: 2026-10-06
- 来源（sources）：claude-workflow-starter-private@296ea45；vllm_omni/config/
