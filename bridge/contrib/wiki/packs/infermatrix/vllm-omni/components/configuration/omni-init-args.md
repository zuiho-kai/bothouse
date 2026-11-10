---
name: omni-init-args
description: Legacy stage YAML 与顶层 EngineArgs：stage_configs_path 下 _strip_single_engine_args 与 strip_parent_engine_args 的过滤合同（_PARENT_ARGS_KEEP、_PARENT_ARGS_NO_WARN、orchestrator 字段移除）、new-format deploy YAML 保留 interleave_mm_strings 与 media_io_kwargs、修改 allowlist 时的最低回归覆盖
metadata:
  scope: 只收 legacy stage_configs_path 启动时顶层 EngineArgs 与 stage YAML 的优先级和剥离合同；legacy engine args 的隔离规则归 rules-legacy-engine-args，deploy YAML schema 归 pipeline-deploy-schema
---
# Legacy stage YAML 与顶层 EngineArgs

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/omni-init-args.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, components, config；created: 2026-07-16；updated: 2026-09-02
- 来源（sources）：PR #5524；claude-workflow-starter-private@296ea45；tests/engine/test_arg_utils.py；vllm_omni/engine/async_omni_engine.py；vllm_omni/engine/arg_utils.py；vllm_omni/entrypoints/utils.py

### 什么时候查这里

- 使用 `stage_configs_path` 启动 legacy 多 stage pipeline。
- 调查顶层 `EngineArgs`、stage YAML 和 runtime override 的优先级。
- 修改 `strip_parent_engine_args`、`_strip_single_engine_args` 或它们的 allowlist。

### 当前合同

- legacy `stage_configs_path` 存在时，`AsyncOmniEngine._resolve_stage_configs` 会在加载 YAML 前调用 `_strip_single_engine_args`：
  1. `vllm` 顶层 `EngineArgs` 的普通默认值和非默认值不会直接泄漏进每个 stage。
  2. 除 `_PARENT_ARGS_NO_WARN` 明确豁免的字段外，被忽略的显式非默认值会记录 warning，不能静默覆盖 YAML。
  3. `_PARENT_ARGS_KEEP` 明确允许的字段继续作为 stage 缺省值；stage YAML 中的显式值仍优先。
  4. orchestrator 字段（例如 `stage_configs_path`）在进入 per-stage `EngineArgs` 前必须移除。
- 当前过滤 primitive 在 `vllm_omni/config/stage_config.py::strip_parent_engine_args`，入口和 allowlist 在 `vllm_omni/engine/async_omni_engine.py::_strip_single_engine_args` 及 `_PARENT_ARGS_*`。CLI 字段 owner 则由 `vllm_omni/engine/arg_utils.py::OrchestratorArgs`、`SHARED_FIELDS` 和 `internal_blacklist_keys` 声明。
- new-format deploy YAML 是另一条合同：识别为 new format 后必须保留 parent CLI 字段进入配置合并，尤其是 `interleave_mm_strings` 与 `media_io_kwargs`；不能复用 legacy `stage_args` 的 stripping 路径，否则 CLI 的 interleave/media override 会在 stage 构造前静默丢失。只有 legacy schema 才执行上述 `_strip_single_engine_args`。^[PR #5524]

### 修改时怎样验证

- 不要再依赖或推荐已不存在的 `nullify_stage_engine_defaults`。
- 增加或移动字段时，先决定它属于 orchestrator、shared 还是 per-stage engine，再修改唯一 owner 集合。
- 至少覆盖：普通 parent field 被丢弃并对非默认值告警、no-warn field 被丢弃但不告警、allowlisted field 被保留、orchestrator-only field 不泄漏、stage-local 显式值覆盖顶层 fallback。
- 真实行为以当前 checkout 的 `tests/engine/test_arg_utils.py` 和 `tests/config/test_config_factory.py` 为最低回归入口；如果 example 仍引用旧 helper，只能视为待清理调用点，不能作为现行合同。
