---
name: pipeline-deploy-schema
description: PipelineConfig 与 deploy YAML 详细 schema（main @ 7a2007cc 复核）：deploy 顶层字段与默认值、StageDeployConfig 平铺字段、stage_config.py 的函数级解析链及行号、StageConfigFactory 与 OMNI_PIPELINES（51 个 key）、omni_config.py 结构化投影、endpoint_policy、composable_parallel 的 strategy-config 轴
metadata:
  scope: 只收 PipelineConfig 与 deploy YAML 的字段级 schema、默认值和带行号的解析链；当前稳定职责与边界归 configuration-architecture，YAML 写作实操归 deploy-yaml，门禁归 configuration-rules-1 至 configuration-rules-3
---
# PipelineConfig 与 deploy YAML 详细 schema

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/pipeline-deploy-schema.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, components, config；created: 2026-07-16；updated: 2026-09-02
- 来源（sources）：claude-workflow-starter-private@296ea45；PR #5647；vllm_omni/config/stage_config.py；vllm_omni/entrypoints/cli/serve.py；docs/configuration/stage_configs.md
- 以下事实在 `main @ 7a2007cc` 复核；当前稳定职责见 [[configuration-architecture]]（Configuration architecture），官方 spec 见 `docs/configuration/stage_configs.md`（schema 全表）与 `composable_parallel.md`。

### 双层 schema：PipelineConfig vs deploy YAML

- **`PipelineConfig`**（模型的冻结 stage 拓扑）由模型的 `pipeline.py` 注册；**deploy YAML**（`vllm_omni/deploy/*.yaml`，79 个）只描述"这些 stage 怎么跑"。public serve 已删除 `--stage-configs-path`；legacy `stage_args` schema 只通过仍存在的 offline/programmatic `stage_configs_path` 合同读取。
- `vllm serve --omni` 未显式给 `--deploy-config` 时，registry 按 `model_type` 自动解析 pipeline + bundled deploy YAML（如 `qwen2_5_omni.yaml` 在 1×H100、`qwen3_omni_moe.yaml` 在 2×H100 验证过）。
- deploy 顶层字段：`base_config`（overlay 父配置，`stages:`/`platforms:` 按 stage_id 深合并、标量 overlay 胜）、`async_chunk`（默认 true）、`connectors`/`edges`（KV 传输图；省略时由 stage 输入自动推导）、`stages`（必填）、`platforms`（npu/rocm/xpu 覆盖，叠在 CUDA 默认之上）、
  - `pipeline`（覆盖 registry key，用于 `qwen2_5_omni_thinker_only` 这类结构变体）以及 pipeline-wide 标量（`trust_remote_code` 默认 true、`dtype`、`quantization`、`enable_prefix_caching` 默认 false、`data_parallel_size`/`pipeline_parallel_size` 默认 1 等）。
- per-stage `StageDeployConfig` 字段直接平铺（无嵌套 `engine_args:`）：`stage_id`（必填，对齐 `PipelineConfig.stages[*].stage_id`）、`max_num_seqs`（默认 64）、`gpu_memory_utilization`（**默认 0.9**——多 stage 共卡时必须显式设，见 [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（rules） `CONF-1a`）、
  - `tensor_parallel_size`、`enforce_eager`、`max_num_batched_tokens`（默认 32768）、`max_model_len`、`devices`（默认 "0"）、`input_connectors`/`output_connectors`（`from_stage_<n>`/`to_stage_<n>` 键引用顶层 `connectors:` 注册名）、`default_sampling_params`、`engine_extras`（未知键兜底，也承载 stage 级覆盖 pipeline-wide 值）。

### 解析链（函数级）

- `resolve_deploy_yaml`（stage_config.py:576，处理 base_config overlay）→ `load_deploy_config`（:602）→ `merge_pipeline_deploy`（:831，冻结拓扑 + 部署参数合并，平台覆盖在此叠加）→ `build_stage_runtime_overrides`（:48，产出逐 stage 运行时 override）；
  - `strip_parent_engine_args`（:93）决定哪些父 EngineArgs 字段进入/剥离每个 stage（消费端在 `engine/async_omni_engine.py`）。

### StageConfigFactory 与 pipeline registry

- `StageConfigFactory`（config_factory.py:47）按 `model_type` 从 `pipeline_registry.OMNI_PIPELINES`（51 个 key）解析出 `PipelineConfig` 或 resolver callable（如 `resolve_qwen3_omni_pipeline`）；HF `model_type` 冲突用 `hf_architectures` 消歧（如 MiMo Audio 的 HF model_type 是 qwen2）；未注册模型报错并列出可用 key（:360）。
  - 单 stage diffusion 模型**不在**该 registry（走 `async_omni_engine.py` 的 `_create_default_diffusion_stage_cfg` 兜底）。`register_pipeline(...)` 支持 out-of-tree 注册。

### 结构化配置与 endpoint 策略

- `omni_config.py`：RFC #4021 Phase 2 的结构化配置——`VllmOmniConfig.from_registry` 组装逐 stage 投影（`OmniStageModelConfig`/`CacheConfig`/`SchedulerConfig`/`ConnectorConfig`/`ParallelConfig`/`DiffusionParallelConfig` 等）。
- `endpoint_policy.py`：`OmniServingCapability`（:21，`RouteTarget` 枚举）+ `shutdown_unsupported_routes`（:65）——pipeline 可关闭自己不支持的 serving 路由。
- `composable_parallel/`：`--strategy-config` 把逐 stage 并行轴栈（tp/dp/pp/ep/stage_replica 已接线；sp/cfg/vae_pp/hsdp 等保留位）以声明式 overlay 叠加到合并后的 stage 上、先于 CLI override；显式 deploy 值与 strategy 派生值冲突时 fail fast，并在 worker 创建前检查 devices 与 `tp × dp × pp` world size。Public serve 已没有 legacy CLI 组合；
  - offline/programmatic resolver 同时收到 `stage_configs_path` 和 `deploy_config_path` 时仍必须拒绝。
- 源码会变化，具体函数与行号在改代码前必须以目标仓库当前版本为准。
