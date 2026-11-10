---
name: configuration-architecture
description: vLLM-Omni 配置构造架构：来源合并、ownership validation、按 owner 分区、构造最终对象四层边界，structured/legacy/direct 数据流图，值状态合同表，默认 factory 与 schema，PipelineConfig 与 deploy YAML 结构及 resolve_deploy_yaml 解析链（main @ 7a2007cc），endpoint_policy 与 composable_parallel
metadata:
  scope: 只收配置构造层的稳定边界、入口源码和数据流现状；可执行门禁归 configuration-rules-1 至 configuration-rules-3，函数级 schema 与行号归 pipeline-deploy-schema，deploy YAML 写作归 deploy-yaml，审计工作法归 config-audit-plain-language
---
# vLLM-Omni 配置构造架构

## 现状

### 职责和边界

- 配置构造层负责把 pipeline/deploy、stage extras、CLI/runtime overrides、默认 factory 和 direct kwargs 转成有明确 owner 的最终配置。它不负责模型算法、服务层请求限制或 orchestrator 专属开关；这些字段只能在各自 owner 的边界消费，不能因为经过同一个字典就进入 diffusion config。
- 严格校验不是新的总 owner。稳定边界固定分为四层：
  1. **来源合并与归一化**：保留来源优先级，处理 alias、flat→nested、可转换标量和兼容路由。
  2. **ownership validation**：只判断规范化后的 key 是否属于 shared、stage、diffusion 或明确的 compatibility owner。
  3. **按 owner 分区**：校验通过后才把 shared engine args、stage config 和 diffusion payload 分开。
  4. **构造最终对象**：typed projection、legacy config 和 direct factory 不再重新解释来源或静默过滤字段。

### 主要源码和调用入口

- 当前主要入口以目标 checkout 的 live 源码为准，职责关系如下：
  - `vllm_omni/config/stage_config.py`：pipeline-wide 与 stage-local overlay、默认值和 stage extras。
  - `vllm_omni/engine/arg_utils.py`：CLI 字段 owner、orchestrator/shared/per-stage 路由集合。
  - `vllm_omni/diffusion/data.py`：diffusion alias、quantization、parallel normalization 和共享 strict validator。
  - `vllm_omni/config/omni_config.py`：structured 构造、shared engine args 分区和 typed diffusion projection。
  - `vllm_omni/engine/stage_init_utils.py`：legacy startup 的 strict partition。
  - `vllm_omni/engine/async_omni_engine.py`：默认 single-stage diffusion factory 和 schema 驱动的 passthrough。

### 数据怎样流动

```text
pipeline / deploy / engine_extras / CLI
                  |
                  v
       stage overlay 与优先级合并
                  |
                  +---------------- structured -----------------+
                  |                                              |
                  |                                   shared normalization
                  |                                              |
                  |                                   full-key validation
                  |                                              |
                  |                           shared args --------+-------- diffusion projection
                  |                                              |
                  +---------------- legacy startup --------------+
                                                                 |
                                                      diffusion-only payload
                                                                 |
                                                OmniDiffusionConfig.from_kwargs

default single-stage factory -> schema-declared passthrough -> legacy startup
direct kwargs ---------------------------------------> direct normalize + strict validate
```

- structured 与 legacy 可以有不同的最终对象，但不能有不同的字段语义。它们必须在第一位 consumer 前共享 normalization 和 full-key validation；差异只允许发生在校验之后的 typed projection 或对象构造。
- `main @ 3d7fc3b9` 的运行边界仍是过渡态：`VllmOmniConfig` 已能构造 typed stage，且 `build_engine_args_dict_from_omni_stage_config()` 可将它投影为 backend flat args；但生产 `StageRuntime`、headless serve 和 diffusion startup 仍把 legacy OmegaConf stage 交给稳定的 `build_engine_args_dict()`，后者委托 `build_legacy_engine_args_dict()`。
  - 因此 typed projection 是 cutover 前的兼容适配器和测试 oracle，不是当前 live startup source of truth；目标 pin 中 typed builder 与 `StageConfigFactory.create_from_model` 都没有 non-test caller。
- `docs/design/architecture_overview.md` 的五层图是目标架构的 conceptual map，不改变上述 live 边界。图中的 authoring→resolve→transport-safe config→launch plan→engine materialization 可用于定位 owner，但 target `9159cedb` 仍不能据此宣称 structured typed startup 已完成 production cutover；
  - review 后的文档使用真实 `BaseVllmOmniStageConfig`、`StageConfigFactory.create_from_model()` 与 `VllmOmniConfig.from_pipeline_config()` 名称，不存在额外 resolver API。^[PR #5914]

### 值状态合同

| 状态 | 必须怎样处理 |
|---|---|
| key 缺失 | 使用 owner 声明的默认值 |
| 已知 key 为 `None` | 只有该 source/overlay owner 明确声明 unset 语义时才丢弃 |
| 已知 key 为 `False` 或 `0` | 作为显式值保留，不能用 truthiness fallback 覆盖 |
| 未知 key 为 `None` | 仍然是 unknown field，不能在校验前过滤 |
| legacy 非空、canonical 为 `None` | canonical 视为 unset，可提升 legacy 值 |
| legacy 与 canonical 都非空 | 按同一 owner 的冲突合同拒绝 |

### 默认 factory 与 schema

- 默认 factory 是公开配置入口，不是可以长期维护第二份字段白名单的捷径。只有明确标记为可序列化 passthrough 的 schema 字段才进入 stage engine args；不可序列化的 runtime object 保留在 metadata，service/orchestrator 字段留在各自 owner。
- 上游新增字段或 rebase 后，必须重新核对：
  1. 字段属于 pipeline、stage、shared engine、diffusion、service 还是 orchestrator；
  2. 是否需要 structured projection、legacy partition、direct factory 或默认 factory 支持；
  3. `None`、显式 falsey 值和冲突值的语义；
  4. 自动合并是否漏掉 owner 集合、derived field 或 passthrough metadata。

### 怎样验证

1. 从每个受影响真实入口走到第一位 consumer，再断言最终 config 或明确错误。
2. 使用“案例 × 入口”参数化矩阵证明 structured、legacy 和 direct 行为一致；另保留默认 factory 与一个未受影响 stage 类型作为 control。
3. 严格错误必须覆盖 unknown non-null 和 unknown `None`；兼容路径必须覆盖 canonical `None`、双非空冲突和显式 `False`。
4. rebase 后在最新 base 上重新运行语义测试，并把自动合并文件作为新 diff 审查；lint、compile、mergeable 或旧 head 的绿测不能代替。

### PipelineConfig 与 deploy YAML 的具体结构

- 以下事实在 `main @ 7a2007cc` 复核；源码会变化，动手前仍须刷新 live 版本。
- **`PipelineConfig`**（模型的冻结 stage 拓扑）由模型的 `pipeline.py` 注册；**deploy YAML**（`vllm_omni/deploy/*.yaml`）只描述“这些 stage 怎么跑”。public `vllm serve --omni` 只接受 `--deploy-config`；offline/programmatic API 仍保留 `stage_configs_path` 读取 legacy `stage_args` schema。
- serve 未显式给 `--deploy-config` 时，registry 按 `model_type` 自动解析 pipeline + bundled deploy YAML；单 stage diffusion 模型不在 registry，走 `async_omni_engine.py` 的 `_create_default_diffusion_stage_cfg` 兜底。
- deploy 顶层字段包括 `base_config`、`async_chunk`、`connectors`/`edges`、`stages`、`platforms`、`pipeline` 和 pipeline-wide 标量。`base_config` 对 `stages:`/`platforms:` 按 stage_id 深合并，标量 overlay 胜；platform 覆盖叠在 CUDA 默认值上。
- per-stage `StageDeployConfig` 字段直接平铺（无嵌套 `engine_args:`）：`stage_id`、`max_num_seqs`、`gpu_memory_utilization`、`tensor_parallel_size`、`enforce_eager`、`max_num_batched_tokens`、`max_model_len`、`devices`、`input_connectors`/`output_connectors`、`default_sampling_params`、`engine_extras`。
- 具体解析链是：

```text
resolve_deploy_yaml
  -> load_deploy_config
  -> merge_pipeline_deploy
  -> build_stage_runtime_overrides
  -> strip_parent_engine_args
  -> engine/async_omni_engine.py
```

- `StageConfigFactory` 按 `model_type` 从 `pipeline_registry.OMNI_PIPELINES` 解析 `PipelineConfig` 或 resolver callable；HF `model_type` 冲突用 `hf_architectures` 消歧，未注册模型必须显式失败并列出可用 key。`register_pipeline(...)` 支持 out-of-tree 注册。

### 结构化配置、endpoint 与 composable parallel

- `omni_config.py` 负责结构化配置和逐 stage typed projection。
- `endpoint_policy.py` 的 `OmniServingCapability` 与 `shutdown_unsupported_routes` 允许 pipeline 关闭不支持的 serving 路由。
- `composable_parallel/` 的 `--strategy-config` 在合并后的 stage 上叠加逐 stage 并行轴；已接线与 reserved axis 必须区分。Public serve 已移除 legacy flag；offline/programmatic resolver 仍须拒绝 `stage_configs_path` 与 `deploy_config_path` 同时出现。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, components, config；created: 2026-07-16；updated: 2026-09-02
- 来源（sources）：claude-workflow-starter-private@296ea45；PR #5647；PR #5678；PR #5914；docs/design/architecture_overview.md；vllm_omni/config/stage_config.py；vllm_omni/config/config_factory.py；vllm_omni/config/omni_config.py；vllm_omni/config/composable_parallel/；vllm_omni/diffusion/data.py
  - vllm_omni/engine/stage_init_utils.py；vllm_omni/entrypoints/cli/serve.py
