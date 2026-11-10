---
name: configuration-rules-1
description: vLLM-Omni 配置开发门禁（1/3）：使用条件、Direct 代码快速入口表（VOMNI-CFG-0a、0b 与 PR 描述→规则组→live 源码）、配置归一化与新老路径一致性 VOMNI-CFG-1a 至 1h 及 VOMNI-CFG-1i（multi-stage 模型的 stage HF config）
metadata:
  scope: 只收入口路由表与归一化、新老路径一致性规则（VOMNI-CFG-0a 至 1i）；VOMNI-CFG-1j 至 1o 与 CONF-1a 至 CONF-2c 归 configuration-rules-2，CONF-3a 起归 configuration-rules-3，白话解释归 config-audit-plain-language，矩阵与操作顺序归 config-normalization-parity
---
# vLLM-Omni 配置开发门禁（1/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/3 部分；第 2 部分 [[configuration-rules-2]]；第 3 部分 [[configuration-rules-3]]
- 源页：`knowledge/repos/vllm-omni/components/configuration/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-07-16；updated: 2026-10-09
- 来源（sources）：PR #7648；claude-workflow-starter-private@296ea45；PR #4281；PR #5031；PR #5073；PR #5671；PR #5678；zuiho-kai/claude-workflow-starter@c217fc6；vllm_omni/config/model.py；vllm_omni/config/stage_config.py；vllm_omni/config/config_factory.py；vllm_omni/config/omni_config.py
  - vllm_omni/config/composable_parallel/；vllm_omni/deploy/qwen3_omni_moe.yaml；vllm_omni/engine/stage_init_utils.py；tests/config/test_config_factory.py；tests/engine/test_arg_utils.py；tests/engine/test_stage_engine_args.py；PR #4795；PR #5842；PR #6082；PR #6156；PR #5741；PR #6068；PR #4765
  - PR #5666；PR #4222；PR #5604；PR #6293；PR #6094；vllm_omni/diffusion/data.py；PR #6050；PR #6322；vllm_omni/config/pipeline_registry.py；vllm_omni/diffusion/models/pi0_pipeline_config.py；vllm_omni/diffusion/models/pi0/pipeline_pi0.py；PR #5048；PR #6458；PR #6102；PR #6308；PR #6182；PR #4820
  - PR #6619；PR #6680；PR #6422；vllm_omni/deploy/higgs_multimodal_qwen3.yaml；PR #7655；PR #7883
- 只在修改 vLLM-Omni 的 config、deploy、pipeline、CLI 字段归属、alias、unknown-field 校验、flat→nested 归一化或默认 factory 时使用。第一次读这些规则时，先看 [[config-audit-plain-language]]（config audit 说人话规则）；需要执行时再看 [[config-normalization-parity]]（config normalization parity） 的矩阵和操作顺序。

### Direct 代码快速入口

- 源码路径相对 `vllm_omni/`；测试路径相对仓库根。
- [VOMNI-CFG-0a] **VOMNI-CFG-0a — 描述选图，diff 验证。** title/body 命中下表后用 pinned changed files 验证；冲突以 live diff/consumer 为准。
- [VOMNI-CFG-0b] **VOMNI-CFG-0b — 命中后停止导航。** 沿 live producer→consumer 审查；仅跨 owner 或具体未知量阻塞时增加 owner/guide。
- （以下为原表格，按行改写为条目）
- PR 描述在做什么：环境变量 inventory
  - 精确规则组：`VOMNI-CFG-3a`
  - 第一批 live 源码：config/environment_variable_inventory.py → tests/config/test_environment_variables.py
- PR 描述在做什么：strict schema、unknown field、alias、flat→nested、structured/legacy/direct parity、typed projection
  - 精确规则组：`strict-normalization`：`VOMNI-CFG-1a`–`1h`；[[rules-legacy-engine-args]]（1s/1t）
  - 第一批 live 源码：`config/stage_config.py::{build_stage_runtime_overrides,strip_parent_engine_args}` → `config/omni_config.py::{_build_diffusion_config_projection,VllmOmniConfig.from_pipeline_config}` →
    - `engine/stage_init_utils.py::{build_engine_args_dict,build_engine_args_dict_from_omni_stage_config}`
- PR 描述在做什么：deploy YAML、`base_config`、pipeline/stage overlay、pipeline-owned alias/hook、headless/offline parity、最终逐 stage config
  - 精确规则组：`deploy-topology`：`CONF-3a`, `CONF-4b`, `CONF-5a`, [[rules-topology-profiles-2]]（CONF-5i；源锚点 #conf-5i-pipeline-专属-alias-与-hook-必须在通用配置层声明归一并消费）, [[rules-topology-profiles-2]]（CONF-5j；源锚点 #conf-5j-pipelineconfig-在构造时必须验证终端-topology）
  - 第一批 live 源码：`config/stage_config.py::{resolve_deploy_yaml,load_deploy_config,normalize_pipeline_cli_overrides,merge_pipeline_deploy,build_stage_runtime_overrides,_build_engine_args}` → `config/config_factory.py::StageConfigFactory.create_from_model` →
    - `engine/stage_init_utils.py::_resolve_model_path`
- PR 描述在做什么：composable strategy、axis、routing、load balancing、`strategy-config`
  - 精确规则组：`composable-strategy`：`CONF-4a`
  - 第一批 live 源码：`config/composable_parallel/strategy_loader.py::{parse_strategy_specs,load_strategy_specs}` → `translator.py::translate_strategy_stack` → `apply.py::apply_strategy_specs` → `config_factory.py::{StageConfigFactory._apply_strategy_specs,StageConfigFactory._reconcile_strategy_with_cli}`
- PR 描述在做什么：`gpu_memory_utilization`、`kv_cache_memory_bytes`、多 stage 共卡、小显存 OOM
  - 精确规则组：`deploy-memory`：`CONF-1a`, `CONF-2a`
  - 第一批 live 源码：`config/stage_config.py::{build_stage_runtime_overrides,_build_engine_args}` → `config/omni_config.py::{_build_runtime_config,_build_parallel_config,VllmOmniConfig.from_pipeline_config}`
- PR 描述在做什么：multi-stage HF sub-config、stage quantization view、`hf_config_name`
  - 精确规则组：`stage-model-config`：`VOMNI-CFG-1i`
  - 第一批 live 源码：pipeline stage declaration → `OmniModelConfig::{draw_hf_text_config,get_model_arch_config}` → vLLM quantization selection
- PR 描述在做什么：pipeline `sampling_constraints`、`StageConfig.to_omegaconf()`、runtime stage config
  - 精确规则组：`stage-config-propagation`：`VOMNI-CFG-1o`
  - 第一批 live 源码：`merge_pipeline_deploy` → `StageConfig.to_omegaconf()` → `engine.stage_configs`
- PR 描述在做什么：stage transport、`requires_full_payload_input`、topology projection 或 override rejection
  - 精确规则组：`stage-transport`：`VOMNI-CFG-1p`
  - 第一批 live 源码：`stage_config.py::{StagePipelineConfig,_build_engine_args}` → `omni_config.py::_build_model_config` → `engine/arg_utils.py::OmniEngineArgs`
- PR 描述在做什么：SymmMem Ulysses transport
  - 精确规则组：[[rules-diffusion-parallel-transport]]（VOMNI-CFG-1q） + `DIFF-4x`
  - 第一批 live 源码：deploy → parallel config → Ulysses
- （以下为原表格，按行改写为条目）
- PR 描述在做什么：HF cache snapshot path、空 `config.json`、name-based pipeline fallback
  - 精确规则组：[[rules-model-reference-routing]]（`model-reference-routing`；源锚点 #conf-7a-模型引用解析必须物化对象存储配置并只从受控名称组件匹配）：`CONF-7a`
  - 第一批 live 源码：`config_factory.py::{_name_match_candidate,StageConfigFactory._try_infer_model_type}` → `pipeline_registry.py::OMNI_PIPELINES` → `tests/config/test_config_factory.py::TestNameMatchCandidateSnapshotPaths`

### 配置归一化与新老路径一致性

- [VOMNI-CFG-1a] **VOMNI-CFG-1a — 编码前冻结受影响合同。** 第一次业务代码修改前，只列当前 diff 会改变的入口和值状态，再加一个默认或相邻 control；不得做所有入口和值的笛卡尔积，也不得省略仍可调用的 legacy/direct 入口。
- [VOMNI-CFG-1b] **VOMNI-CFG-1b — 在第一位 consumer 前归一化。** 对 changed value 标出实际对象、copy/转换边界和第一位 consumer；归一化必须在该 consumer 之前完成。从 unknown 集合排除字段时，必须证明值进入明确 owner 且能从结果读回。
- [VOMNI-CFG-1c] **VOMNI-CFG-1c — 用同路径行为证据验收。** 受影响 legacy/structured 路径必须对相关 `null`、有效值、冲突值或可转换标量得到相同结果；至少一个非默认值走到第一位 consumer 和最终 config。helper 单测只能补充，最后必须在含 `vllm` 的兼容环境实跑目标测试。
- [VOMNI-CFG-1d] **VOMNI-CFG-1d — 兼容修复不能自动继承原 scope。** 新修复若引入新的 owner、来源、优先级、转换或模型/服务路由，或实现量级接近预估两倍，必须先重切片；禁止按入口堆特例和重复测试。多 PR RFC 只实现当前 PR 的 merge condition，后续切片或顺手修复的行为连同专属测试一起 `DELETE / DEFER`，不能因为已经写完或测试通过就继承为当前 scope。验收时每个生产代码 hunk 都应属于本轮目的，同一语义跨入口使用参数化矩阵并保留一个 control。
- [VOMNI-CFG-1e] **VOMNI-CFG-1e — 严格配置固定按“归一化、验 owner、分区、构造”执行。** deploy/stage/CLI overlay、alias 和 flat→nested 转换必须先产出一份规范化映射；mixed CLI/orchestrator namespace 只允许先路由已明确声明的非 stage scope，剩余 stage 候选必须以完整 key 集合进入 ownership validator。validator 不能同时改值、路由字段或先丢 `None`；
  - 校验通过后的规范化结果就是后续分区和构造唯一可消费的 owner artifact，禁止只调用 validator 却继续传 raw mapping，也禁止末端重新做 alias、default、precedence 或静默过滤。structured、legacy startup 和仍公开可调用的 direct factory 必须复用同一组 normalization/validation primitive。
- [VOMNI-CFG-1f] **VOMNI-CFG-1f — key 是否已知与 value 是否有效必须分开判定。** 缺失、已知字段的 `None`、显式 `False`/`0`、未知字段的 `None` 和两个非空来源冲突是五种不同状态：只有明确 owner 可以把已知 `None` 解释为 unset，`False`/`0` 不得被 truthiness merge 吃掉，未知 key 即使为 `None` 也必须按 strict contract 报错，alias 只在 legacy 与 canonical 都提供非 `None` 值时冲突。
  - 验收至少覆盖本轮会改变分支的这些状态，并断言错误或最终 consumer。
- [VOMNI-CFG-1g] **VOMNI-CFG-1g — rebase 或 schema 扩张后重新做配置归属审计。** 上游新增 dataclass 字段、默认 factory 参数、pipeline-wide 字段或 owner 集合变化时，把自动合并结果当作新的语义 diff；重新比较 base/head 的字段集合、序列化边界、默认-stage 透传和所有严格入口。
  - 部署拥有的 lifecycle field 必须在 structured stage model config 与 legacy engine-args projection 中都显式写入，并由 `OmniEngineArgs.create_model_config()` 到最终 `OmniModelConfig`；默认值相同不能证明该投影存在。默认 factory 的扩展字段应由 schema metadata 或单一声明集合驱动，禁止再加一份手写白名单。
  - 只有最新 base 上的真实 factory/legacy/structured 路径都保留合法非默认值并继续拒绝未知字段，才算 rebase 完成。^[PR #6680]
- [VOMNI-CFG-1h] **VOMNI-CFG-1h — typed engine projection 与生产 cutover 是两个 merge condition。**
  - `build_engine_args_dict_from_omni_stage_config` 从 model/load/cache/scheduler/runtime/connector/parallel/quantization/diffusion typed owner 深拷贝非 `None` 字段，再与 legacy 共用 model/tokenizer precedence、connector injection、worker resolution、generation cache defaults 与 diffusion attention normalization；
  - 不允许增加 catch-all `engine_args`。但在 target `3d7fc3b9`，稳定入口 `build_engine_args_dict` 仍明确委托 `build_legacy_engine_args_dict`，runtime/headless/diffusion startup 仍传 legacy stage shape；
  - `StageConfigFactory.create_from_model` 与 `build_engine_args_dict_from_omni_stage_config` 均无 non-test caller，所以 typed path 是纯 preparatory/test-only，不能声称生产已经“从 VllmOmniConfig 读取”。cutover 前须把 strategy/replica/startup-plan 一并改为 typed input，并用 live startup 测试证明。
  - review 暴露的 typed-only defaults、unowned field 静默丢失、model/tokenizer subdir 与 omni-KV precedence 问题，final 以“保留 unset backend default、合并后按 execution type 验 owner、未知 owner 拒绝、全 backend field 双向 effective parity”修正；新增字段后该 exhaustive census 必须重新运行，不能只维护几个 deferred-default 白名单。
  - 但 registry parity test 会跳过没有具体 HF config 就无法 `resolve_pipeline_config` 的 callable entry（当前包括 `qwen3_omni_moe`），并非字面 exhaustive；cutover 前每种 resolver variant 都须补 concrete HF-config fixture。^[PR #5678]
- [VOMNI-CFG-1i] multi-stage 模型必须显式选择同一份 stage HF config
  - 触发：nested HF config 的模型新增/修改 `hf_config_name`、text config、quantization metadata、embedding width，或 pipeline stage 拆分。
  - 强制：每个 stage 的 `hf_config_name` 必须同时驱动 `draw_hf_text_config()`、`get_model_arch_config()` 和 input-embedding width 查询，不能让三者各自回退到 root 的默认 text config。top-level quantization config 继续走通用 vLLM resolver；stage sub-config 与 ignore/exclude 规则共同决定实际 quantized modules，不增加 model-type string 特判。
  - 验收：逐 stage 断言选中的 sub-config 与 architecture/quantization view；覆盖一个无 embedding override 的 AR control，证明 input width 回退到该 stage text hidden size。Qwen2.5-Omni 当前为 Thinker=`thinker_config`、Talker=`talker_config`、Code2Wav=`thinker_config`，thinker-only 也用 `thinker_config`。
    - 最终 diff 只测 stage 名与 Qwen3 无 override control，未直接单测 Qwen2.5 Talker overridden-width runner path；该缺口见 [[rules-bridge-batch-1]]（EXEC-1d；源锚点 #exec-1d-cross-stage-embedding-buffer-必须按-ingress-width-分配）。^[PR #5073]

## 决策与踩坑

- [VOMNI-CFG-1i] 禁止：因为 root 默认返回 Thinker 就省略 Talker/Code2Wav 声明；给每个模型复制 quantization resolver；仅断言 pipeline 字段存在而不追到 quant config、text hidden size 与 runner consumer。
