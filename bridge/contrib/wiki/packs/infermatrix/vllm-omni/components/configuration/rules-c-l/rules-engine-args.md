---
name: rules-engine-args
description: 规则 VLLM-OMNI-PR8585-DIFFARGS-FROMCLI：非并行 diffusion engine 参数（num_gpus、cache_backend、step_execution、flow_shift 等）必须以 None 默认声明在 OmniEngineArgs 并镜像 SHARED_FIELDS，否则 from_cli_args 静默丢弃（#8503 根因）；DIFFUSION_NON_PARALLEL_ENGINE_ARGS 测试表
metadata:
  scope: "只收 PR #8585 的非并行 diffusion engine 参数声明一条规则；legacy engine-args 投影与 text_encoder_tp_size（VOMNI-CFG-1r 至 1u、CFG-TEXT-ENCODER-TP-1a）归 rules-legacy-engine-args"
---
# vllm-omni 配置 · engine args 评审规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-engine-args.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-10-26；updated: 2026-10-26
- 来源（sources）：PR #8585
- [VLLM-OMNI-PR8585-DIFFARGS-FROMCLI] 非并行 diffusion engine 参数必须在 OmniEngineArgs 声明并镜像 SHARED_FIELDS
  - 触发：改动 `vllm_omni/engine/arg_utils.py` 中 `OmniEngineArgs` 的 diffusion 字段声明或 `SHARED_FIELDS` 集合；新增、改名或删除 serve CLI 注册在 `OrchestratorArgs` 上、而 diffusion stage 引擎会消费的非并行 engine 参数（含 `vllm_omni/engine/stage_init_utils.py` 对这些参数的下游传递）；
    - 或改动 `tests/engine/test_arg_utils.py` 的非并行参数测试与 `DIFFUSION_NON_PARALLEL_ENGINE_ARGS` 表。
  - 强制：`OmniEngineArgs.from_cli_args`（继承自 vLLM `EngineArgs.from_cli_args`）只保留 dataclass 已声明的字段，未声明的 knob 在库路径上于到达 diffusion stage 前被静默丢弃（#8503 的根因，是 #7564/#7652 只覆盖 `text_encoder_tp_size` 的失效模式的推广）。
    - 因此每个此类非并行参数（`num_gpus`、`cache_backend`、`cache_config`、`step_execution`、`flow_shift`、`boundary_ratio`、`vae_use_tiling`、`diffusion_compile_*`、`diffusion_load_format`、`diffusion_kv_cache_*`、`diffusion_offload_config`、`default_sampling_params` 等）都必须以 `None` 默认值声明在 `OmniEngineArgs` 上，
    - 使 unset 值保持未设置不向下游传播；并因两个类同时声明而镜像进 `SHARED_FIELDS`（由 `tests/engine/test_arg_utils_shared_fields.py` 守护）。新增此类参数时必须同步加入 `DIFFUSION_NON_PARALLEL_ENGINE_ARGS`，且取值须与 `OmniDiffusionConfig` 默认值不同，使被静默重置的字段能被 `test_from_cli_args_preserves_non_parallel_diffusion_engine_args` 抓住；
    - 落地语义由 `test_non_parallel_diffusion_engine_args_reach_default_diffusion_config` 式验证：显式覆盖经 `StageConfigFactory.create_default_diffusion` 后，`cache_backend`/`step_execution`/`flow_shift` 等直达 `engine_args`，`num_gpus` 解析为 `parallel_config.data_parallel_size`。
    - 既有 raw-kwargs 的 `validate_omni_diffusion_kwargs` fail-closed 校验保持不变。
  - 验收：`pytest tests/engine/test_arg_utils.py`（含两个非并行参数测试）与 `tests/engine/test_arg_utils_shared_fields.py` 通过；`OmniEngineArgs` 声明的每个非并行 diffusion 字段默认值为 `None` 且出现在 `SHARED_FIELDS`；同一参数作为 raw kwargs 与 from_cli_args 路径均能到达 diffusion stage。^[PR #8585]

## 决策与踩坑

- [VLLM-OMNI-PR8585-DIFFARGS-FROMCLI] 禁止：让新的非并行 diffusion 参数只存在于 `OrchestratorArgs` 而不声明到 `OmniEngineArgs`（库路径会静默丢弃）；把这些字段的 dataclass 默认值写成非 `None` 常量使 unset 值被传播；把 orchestrator 专属字段（`enable_ar_profiler`、`log_file`、`replica_id`、`omni_replica_address`）声明到 `OmniEngineArgs`；
  - 把 #8037 的 11 个并行 knob（由 #8041 处理，与本集合字段不相交）混入本规则范围；测试取值与 `OmniDiffusionConfig` 默认值相同，导致丢弃无法被发现；删除上述回归测试或从表中移除既有字段。
