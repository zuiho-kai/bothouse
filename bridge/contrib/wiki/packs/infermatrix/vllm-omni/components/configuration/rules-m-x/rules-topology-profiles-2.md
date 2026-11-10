---
name: rules-topology-profiles-2
description: topology 与部署 profile 合同（2/2）CONF-5h 至 5m：多组件 checkpoint 的 root 身份与 stage 子目录、PipelineConfig.stage_cli_aliases 与 hook 及 inline diffusion、__post_init__ 验证终端 topology、--stage-overrides parser 只验 shape、LLM additional_config 的 runtime owner、stage model_runner v1/v2 override 与平台门禁
metadata:
  scope: 只收 CONF-5h 至 CONF-5m；CONF-5a 至 CONF-5g 归 rules-topology-profiles-1，并行拓扑 CONF-4a 至 4g 归 rules-parallel-topology
---
# topology 与部署 profile 合同（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-topology-profiles.md` 的第 2/2 部分；第 1 部分 [[rules-topology-profiles-1]]
- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-topology-profiles.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-09-04；updated: 2026-10-06
- [CONF-5h] 多组件 checkpoint 必须闭合 root 身份、stage 子目录与默认部署
  - 触发：新增由多个子目录组成、root `config.json` 自报 composite architecture，或需要按 stage 加载不同 checkpoint/tokenizer 子目录的模型，并同步新增 pipeline、默认 deploy 或架构注册。
  - 强制：闭合 checkpoint `model_type`、pipeline registry key、`model_arch`、`default_deploy_config_name` 与 registry architecture；每个 stage 明确 `model_subdir`/`tokenizer_subdir` 和实际权重根目录，最终 stage config 保留 CFG 等 engine gate 所需声明。
  - 验收：用 bare root config、无显式 deploy 的 startup 和 structured/legacy 路径断言 pipeline、默认 deploy、stage 子目录、architecture 与 sampling-extra key 均进入最终逐 stage config；单卡与双卡配置除设备 placement 外保持一致。 ^[PR #6186]
- [CONF-5i] pipeline 专属 alias 与 hook 必须在通用配置层声明、归一并消费
  - 触发：pipeline 需要把全局 CLI 字段改写到特定 stage，或声明 stage-0 prompt transform、按 task 解析 checkpoint 的 hook、显式 inline diffusion。
  - 强制：alias 由 `PipelineConfig.stage_cli_aliases` 唯一声明并在 structured/legacy factory 进入 stage merge 前归一；canonical `stage_<id>_<target>` 与 alias 同时出现时，canonical 值优先并告警，alias 出现在其他 stage 必须拒绝。`prompt_transform_func`、`model_path_resolver` 与 `inline_diffusion` 由 `StagePipelineConfig` 投影到唯一 consumer；
    - resolver 必须在构造 backend engine args 前消费并移除。所有 inline path 都要求 `plan.num_replicas == 1`；whole pipeline 只有一个 stage 时默认 inline，多 stage 只允许 `inline_diffusion=true` 或已有 `custom_pipeline_args` in-process owner opt in，其余均 subprocess。
  - 验收：structured/legacy 两路覆盖 alias-only、canonical-only、相同/冲突值、错误 stage 与 unset control；用 root/partition/task path 证明 resolver 到达 stage model/tokenizer consumer，并用 single-stage、multi-stage opt-in/control 与 multi-replica veto 证明 exact inline predicate。
    - PR #6813 只新增 default one/two-stage 参数化 test，其他组合仍须补验收。^[PR #5885] ^[PR #6813]
- [CONF-5j] PipelineConfig 在构造时必须验证终端 topology
  - 触发：修改 `PipelineConfig.__post_init__`、`get_validation_errors()`、静态 `OMNI_PIPELINES` registry，或新增/调整 multi-stage pipeline 的 `final_output` 声明。
  - 强制：`__post_init__` 必须调用 `get_validation_errors()`，有 error 时以 formatted `ValueError` eager fail；保留 nonempty stages、unique IDs、valid nonself inputs、entry 与任意位置 terminal `final_output=True`。静态 registry 在构造时通过 guard；resolver callable 仅在 concrete object materialize 时受 guard。
  - 验收：无 stages/terminal、duplicate ID、invalid/self input eager error；terminal-not-last 与有效 fixture pass；static configs pass，resolver concrete result materialization guarded。^[PR #6291] ^[PR #6829]
- [CONF-5k] `--stage-overrides` parser 只验证 shape，字段语义留给下游 owner
  - 触发：修改 `parse_stage_overrides`、`--stage-overrides` CLI 输入、stage-scoped override forwarding，或考虑在 parser 对字段名、值类型、范围或 stage existence 做校验。
  - 强制：对 falsey raw input（包括 `None`、`False`、`0`、空 string/容器）在任何验证前返回 `None`；truthy string 先 JSON parse，再要求 top-level 为 dict、每个 key 为 ASCII `isdigit()` string、每个 value 为 dict。非空 outer dict 中的空 inner dict 合法；parse 后的空 dict 返回 `None`。
    - 保留所有 inner fields 原样，不在 parser 建 allowlist，也不在此层做 field type/range 或 stage-id existence 校验。
  - 验收：覆盖 falsey raw passthrough、invalid JSON、truthy JSON list/scalar/bool rejection、non-ASCII/non-string/negative/float stage key rejection、non-dict inner value rejection，以及 `{"0": {}, "1": {}}` pass-through。
    - 再证明 `extras` 到 default-diffusion fallback/registered stage merge 的既有 owner、surviving `stage_<id>_<key>` 到 `cli_overrides` 的 forwarding 均未被 parser 截断；未知 `OmniEngineArgs` field 仅在 `filter_dataclass_kwargs` 被 drop 并留下命名该 field 的 WARNING。^[PR #6230]
- [CONF-5l] LLM `additional_config` 必须经 runtime owner 投影，且不侵占 diffusion owner
  - 触发：deploy/`engine_extras`/CLI 为 stage 传入 `additional_config`，或修改 `_RUNTIME_ENGINE_FIELDS`、`OmniStageRuntimeConfig`、`build_engine_args_dict_from_omni_stage_config`。
  - 强制：LLM/AR stage 把 `additional_config` 纳入 runtime typed owner，深拷贝投影到最终 engine args；diffusion stage 继续只由 diffusion config projection 拥有该字段，runtime 侧保持 `None`。未知字段校验与跨 stage 隔离不变。
  - 验收：LLM stage round-trip 非默认值到 engine args 且 mutation 不回写 source/邻 stage；MiniCPM-o NPU profile 读回 graph keys；diffusion stage 断言值只在 `diffusion_config.additional_config`。^[PR #7272]
- [CONF-5m] stage runner override 必须与 native session 和平台门禁一起解析
  - 触发：修改 `StageDeployConfig.model_runner`、runner resolution、平台overlay或 mixed V1/MRv2 pipeline。
  - 强制：stage的`v1|v2`覆盖deploy默认，legacy/structured两路把同一结果投影到`use_v2_model_runner`；native MRv2、存在upstream input的stage只允许`session_mode=turn`。平台V1 fallback清除既有stage V2 opt-in，完成platform stage overlay后再校验最终值；NPU/XPU最终含任一V2仍须拒绝。
  - 验收：stage/deploy precedence、invalid runner、native turn/control与非turn拒绝、V1平台fallback及overlay后NPU/XPU拒绝都覆盖legacy/structured结果。^[PR #8184]

## 决策与踩坑

- [CONF-5h] 禁止：只依赖路径 basename、文件存在或 `trust_remote_code` 推断 pipeline；让 root architecture 覆盖 stage architecture；让单卡与多卡 profile 复制不同 topology 或行为合同。
- [CONF-5i] 禁止：在 CLI、factory 或 stage startup 为模型名硬编码 alias/resolver；把 alias 广播到所有 stage；因 diffusion stage 只有一个 replica 就隐式改变所有多 stage pipeline 的进程隔离。
- [CONF-5j] 禁止：保留 public `validate()` API 或 registry posthoc sweep；从最后 stage、stage 数、entry/input、`final_output_type` 推断 terminal；不得声称 resolver 后有独立 revalidation、cycle/runtime/E2E proof。
- [CONF-5k] 禁止：把 `[]`、`0`、`false` 等 truthy JSON string 的 parsed scalar/container 当作 “无 override”接受；用只含 deploy schema 的 allowlist 拒绝 `extras` 或 `kv_cache_dtype`、`seed`、`swap_space`、`block_size`、`stage_connector_spec` 等 stage-scoped engine args；
  - 用 `str.isdigit()` 而不加 ASCII guard，导致 fullwidth digit 绕过并在下游错误路由。
- [CONF-5l] 禁止：因 diffusion 已有同名字段就拒绝 LLM stage；让 LLM 与 diffusion 共享同一 mutable dict；在 projection 静默丢弃 NPU Code2Wav 等已声明的 LLM `additional_config`。
- [CONF-5m] 禁止：只按pipeline默认选择runner；通过free-form engine args绕过structured owner；让native下游MRv2接受streaming/duplex；在平台overlay前校验一次后漏掉stage override。
