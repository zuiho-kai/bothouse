---
name: rules-legacy-engine-args
description: 规则 VOMNI-CFG-1r、1s、1t、1u、CFG-TEXT-ENCODER-TP-1a、CFG-CLI-ALIAS-1a：legacy engine-args projection 递归 deepcopy detach、global stage engine args 先验 owner 再按 execution_type 投影、disable_log_stats 负向 alias、upstream ModelConfig CLI 的 typed stage owner、text_encoder_tp_size、no_guardrails 规范化
metadata:
  scope: 只收 legacy engine args 投影隔离与全局 stage CLI 字段归属的六条规则；strict normalization 的 VOMNI-CFG-1a 至 1h 归 configuration-rules-1，非并行 diffusion 参数声明归 rules-engine-args
---
# legacy engine args 投影隔离

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-legacy-engine-args.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-09-05；updated: 2026-10-09
- 来源（sources）：PR #6783；vllm_omni/engine/stage_init_utils.py；tests/engine/test_build_engine_args_no_mutate.py；PR #5929；PR #7237；PR #7390；PR #7652；PR #7917
- 置信度（confidence）：high
- [VOMNI-CFG-1r] legacy engine-args projection 必须递归 detach source config
  - 触发：`build_legacy_engine_args_dict`、`_to_dict(stage_config.engine_args)`、finalizer、connector 或 default injection 修改。
  - 强制：先对 `_to_dict(stage_config.engine_args)` `deepcopy`，再 pop/delete/finalize/inject；source template 和所有 nested mutable objects 不得改变，重复 build 的结果等价且 idempotent。实际 `inject_omni_kv_connector_config` 在 returned dict 的 resolved connector mutation path 也必须不能 leak 回 source。
  - 验收：覆盖 pop/finalizer/default/nested dict、two successive builds，以及 connector injection 后 source snapshot 不变。证据为 CPU regression/reviewer approval；不证明 typed projection、runtime connector success 或 hardware behavior。^[PR #6783]
- [VOMNI-CFG-1s] global stage engine args 必须先验 owner，再按执行类型投影
  - 触发：新增或修改全局 stage CLI 字段、stage-scoped alias、`diffusion_offload_config`，或调整 structured/legacy 的 stage runtime overrides。
  - 强制：先对完整规范化后的 stage CLI 映射做 ownership 校验，再按每个 stage 的 `execution_type` 投影到该 stage；显式 stage 覆盖优先，全局字段只有在目标 stage 实际拥有该字段时才可透传。任何 pipeline 中没有 owner 的显式全局 engine arg 都必须在构造前 fail closed，不能静默丢给无关 stage 或靠默认值吞掉。
  - 强制：`diffusion_offload_config` 这类跨进程序列化的 public mapping 必须保留 raw dict 进入 dataclass/config serialization，同时在 stage 构造前调用其专属 parser 做一次结构校验；兼容 alias 只能 materialize 成同一份内部策略，不能让 compile/offload 约束只检查旧布尔字段。
  - 验收：覆盖 global 与 stage-specific override precedence、unowned global field rejection、`diffusion_offload_config` 的 direct/deploy/structured reachability，以及 compile-mode 对 module/layer/distributed-layer 三种 offload strategy 的统一 incompatibility gate。^[PR #5929]
- [VOMNI-CFG-1t] CLI-only 负向 alias 不得进入 stage ownership 校验
  - 触发：继承 upstream CLI 负向开关（如 `--disable-log-stats`），或修改 `_NON_STAGE_ENGINE_CLI_FIELDS`、`AsyncOmniEngine._resolve_stage_configs`、headless `cli_overrides`。
  - 强制：把该 alias 标为非 stage 字段；在 `log_stats` 等 canonical 值已由 launcher/`__init__` 消费后，于 resolver 边界 `pop` 残余 alias，使 structured ownership 看不到它。标准与 headless 启动都必须消费。
  - 验收：断言字段在 `_NON_STAGE_ENGINE_CLI_FIELDS` 且不在 global stage CLI fields；engine 与 headless 解析后 kwargs/`cli_overrides` 不含该 alias；带 alias 的 TTS/structured pipeline 仍能构造。^[PR #7237]
- [VOMNI-CFG-1u] 用户可见的 upstream ModelConfig CLI 必须有 typed stage owner
  - 触发：文档/示例使用的全局 ModelConfig
    - CLI（如 `served_model_name`、`allowed_local_media_path`、`allowed_media_domains`、`max_logprobs`、`logprobs_mode`、`mm_processor_kwargs`、`mm_processor_cache_type`、`hf_token`、`hf_config_path`、`generation_config`、`override_generation_config`、`enable_prompt_embeds`）在 `from_pipeline_config` 报无 owner，
    - 或新增同类 upstream ModelConfig 输入。
  - 强制：把字段同时加入 `_ModelEngineOverrides` 与 `OmniStageModelConfig`，类型跟随 vLLM `EngineArgs`，默认 `None`，使 `_project_omni_config_fields` 只投影用户显式值，并经 typed/legacy engine-args 到达各 stage。不得把这些 ModelConfig 输入塞进 `_NON_STAGE_ENGINE_CLI_FIELDS` 来绕过 ownership。
  - 验收：对至少两个 pipeline key 参数化断言显式全局值进入每个 stage 的 `model_config`，并用 typed `build_engine_args_dict_from_omni_stage_config` 读回同一集合；字段集合 census 必须包含这些 owner。^[PR #7390]
- [CFG-TEXT-ENCODER-TP-1a] text encoder TP 的 library 与 CLI 入口均保留显式值
  - 触发：修改 OmniEngineArgs、from_cli_args 字段过滤或 default diffusion parallel config。
  - 强制：text_encoder_tp_size 以 int|None、默认 None 保留在 OmniEngineArgs；显式 library/CLI 值经 from_cli_args 到达默认 diffusion parallel config，未设置值仍走原默认。
  - 验收：构造 library args 与 CLI Namespace，显式 2 读回最终 config 仍为 2，缺省路径保持原值。 ^[PR #7652]
- [CFG-CLI-ALIAS-1a] no_guardrails 在 strict diffusion ingress 前规范化
  - 触发：修改 --no-guardrails parser、headless overrides 或 diffusion normalize。
  - 强制：将负向 alias 消费为 canonical model config guardrails=False，在 strict diffusion ingress 前移除残余 no_guardrails；普通 serve 与 headless 共用同一效果。
  - 验收：真实 parser 与 headless 路径都检查 canonical False 和 alias 消失；无关 unknown key 仍被拒绝。 ^[PR #7917]

## 决策与踩坑

- [VOMNI-CFG-1r] 禁止：只 shallow copy、只测 top-level no-mutation，或让 legacy projection 因上一次 build 的 resolved/default/connector state 改变下一次输出。
- [VOMNI-CFG-1s] 禁止：先按 execution type 过滤再做 unknown/owner 校验；只在 direct path 校验而让 deploy/structured 漏检；把 raw mapping 先转成内部对象后再跨进程传输；或让 `full` compile compatibility 继续只识别 legacy offload flags。
- [VOMNI-CFG-1t] 禁止：让 residual `disable_log_stats` 落入 `resolve_omni_config` / `VllmOmniConfig` 并报 “no structured config owner”；为通过校验而放宽真正的 stage engine-arg ownership。
- [VOMNI-CFG-1u] 禁止：仅因 legacy `build_stage_runtime_overrides` 仍能透传就让 structured ownership 拒绝文档命令；把尚未归属的非 ModelConfig 开关（如 `enable_lora`/`speculative_config`）一并放行。
- [CFG-TEXT-ENCODER-TP-1a] 禁止：在字段过滤时丢弃显式 text encoder TP，或拿 registered pipeline alias 选择代替 TP 值透传。
- [CFG-CLI-ALIAS-1a] 禁止：放宽未知字段校验来接纳 CLI-only alias，或删除 alias 却丢失显式 False。
