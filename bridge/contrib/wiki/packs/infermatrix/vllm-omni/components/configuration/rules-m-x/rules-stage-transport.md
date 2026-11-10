---
name: rules-stage-transport
description: "规则 VOMNI-CFG-1p 与 VOMNI-CFG-1v：requires_full_payload_input 只由 StagePipelineConfig topology 声明并无条件覆盖进最终 model config，deploy/CLI 不能改写；DeployConfig.async_chunk 的缺省与 CLI None 保留自动模式并按 pipeline 能力解析（PR #6149、PR #5099）"
metadata:
  scope: 只收 stage 完整 payload 输入能力及其 config projection、async_chunk 自动模式两条规则；SymmMem Ulysses transport 开关（VOMNI-CFG-1q）归 rules-diffusion-parallel-transport
---
# Stage transport capability

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-stage-transport.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config, scheduler, connectors；created: 2026-09-04；updated: 2026-10-06
- 来源（sources）：vllm_omni/config/stage_config.py；vllm_omni/config/omni_config.py；vllm_omni/engine/arg_utils.py；tests/config/test_omni_config.py；tests/config/test_config_factory.py；tests/engine/test_arg_utils.py；PR #6149；PR #5099
- 适用于 pipeline stage 的完整 payload 输入能力、其 config projection，以及 deploy/CLI 对该能力的覆盖。调度侧的 admission 和 async sender/receiver 合同见 [[scheduler-rules-2]]（Scheduler rules；源锚点 #sched-6b-full-payload-admission-是解析后的-downstream-capability）；
  - worker connector 验证见 [[model-executor-rules-2]]（Model Executor rules；源锚点 #exec-3c-connector-required-stage-必须在-worker-启动前验证-runner-capability）。
- [VOMNI-CFG-1p] stage transport capability 只能由 pipeline topology 解析
  - 触发：新增或修改 stage 输入传输、`requires_full_payload_input`、deploy/CLI override 或 engine-args projection。
  - 强制：完整 payload 的消费能力在 `StagePipelineConfig` 中声明，并在 legacy 与 structured 配置构造时无条件覆盖进最终 `OmniStageModelConfig`、`OmniEngineArgs` 与 `OmniModelConfig`；必须保留 `False`，且 deploy 的 flat key、`engine_args`、`engine_extras` 和 CLI 都不能伪造或覆盖该 topology 结论。
  - 验收：覆盖旧 allowlist 对应的 pipeline declarations 和一个 token-only control；三个 legacy YAML 拼写及 CLI override 均因没有 structured owner 而拒绝；从 pipeline 到最终 model config 断言 true/false 均完整保留。^[PR #6149]
- [VOMNI-CFG-1v] async-chunk 的自动模式必须保留 unset 并按 pipeline 能力解析
  - 触发：修改 `DeployConfig.async_chunk`、CLI overlay、async-chunk processor 选择，或 legacy/structured 两路的 stage 配置构造。
  - 强制：缺省及 CLI `None` 保留自动模式；只有多 stage、存在 stage 间输入边且声明 next-stage async processor、并且没有 native AR→DiT `kv_transfer_config` 时才默认启用。显式 `False` 必须保留；显式请求单 stage、不支持的 pipeline 或 KV-transfer 冲突时必须告警并关闭。两条构造路径复用同一解析及 per-stage edge 校验。
  - 验收：分别覆盖 omitted、`None`、true、false、单 stage、缺 processor、KV-transfer，以及相邻 stages 模式不一致；断言最终 stage flags、sync/async processor 和应有告警，而不是只检查中间 deploy 对象。^[PR #5099]

## 决策与踩坑

- [VOMNI-CFG-1p] 禁止：用 architecture/stage 名 allowlist 重新推断能力；让 free-form deploy/CLI 在 producer 校验之后改写 transport；把 async producer 的 `async_chunk` 发送职责误当作下游 full-payload wait capability。
- [VOMNI-CFG-1v] 禁止：把 CLI `None` 经 `bool()` 转为禁用；对所有多 stage 默认开启；把“不支持时关闭”扩大为吞掉 producer/consumer 的不一致配置错误；让两条构造路径选择不同 processor。
