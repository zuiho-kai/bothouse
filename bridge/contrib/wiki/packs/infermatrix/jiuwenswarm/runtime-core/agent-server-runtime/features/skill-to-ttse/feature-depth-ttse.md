---
name: feature-depth-ttse
description: FACT/TIP 双轨经验（TTSE）实现深读：对 agent_observability 轨迹的依赖、TTSE rail 按 _instance 条件挂载、ttse_consult 调用约定与 _ttse_consult_knobs、react.ttse 合并优先级与固定 bank 路径、_build_ttse_rail 降级、免 SKILL.md 修改的取舍推断、consult eager helper 单测
metadata:
  scope: 收 TTSE 在 interface_deep.py 的挂载、配置与降级实现级证据，来源另含 coordinator.py、test_agentserver_modes.py；职责、接口与配置概览归 feature-ttse，技能正文演进归 feature-depth-skill-evolution
---
# FACT/TIP 双轨经验：实现深读

## 现状

- [[feature-ttse]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **对 agent_observability 轨迹的强依赖** TTSE 的轨迹归纳依赖 LLM/工具 span：开启 TTSE 时 Host 会像 Skill/Symphony 演进一样自动拉起 `agent_observability`（即使其 `enabled: false`），否则 `run_evolution` 因无轨迹而静默跳过。TTSERail 本体由 agent-core 提供，缺失时 Host 侧降级跳过。
- 来源：[docs/zh/TTSE.md:L5–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L5-L7)
- **TTSE rail 按 `_instance`、已有 rail 与构建结果条件挂载（agent 模式）** `_ensure_ttse_rail_registered` 在 `_instance` 为 None 时直接返回；`_ttse_rail` 已存在时仅用 `_config_cache` 同步配置并标记 consult 暴露后返回。否则调用 `_build_ttse_rail`：缺 TTSERail/TTSEConfig、TrajectorySpanProcessor 为 None 或构造异常均记录 warning 并返回 None，此时不注册；
  - 成功构造 TTSERail 才 `await register_rail(rail)`、保存 `_ttse_rail` 并记录日志。文档将此挂载限定为 `react.ttse.enabled` 开启后的 agent 模式，agent-core 缺该 rail 时 Host 侧降级跳过。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8458–L8472](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L8458-L8472),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8223–L8330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L8223-L8330),
  - [docs/zh/TTSE.md:L1–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L1-L7)
- **ttse_consult 文档调用约定与 Host 端 _ttse_consult_knobs 参数解析（非工具本体）** 文档约定模型调用 `ttse_consult(category=…, query=…)`，两参数必填，查全集用 `category=all`。Host 的 `_ttse_consult_knobs` 仅解析参数，返回 (consult_top_k, consult_retrieve_mode)：top_k 默认 8，int 抛 TypeError/ValueError 或 ≤0 回退 8；
  - 模式优先用 agent-core 的 normalize_consult_retrieve_mode，ImportError 时本地兜底只接受 hybrid/embed/bm25，否则取 hybrid。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8201–L8221](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L8201-L8221),
  - [docs/zh/TTSE.md:L31–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L31-L31)
- **react.ttse 合并优先级（runtime 键覆盖 yaml）与文档默认；bank 路径固定不可配** `_merge_ttse_config` 先取 yaml `react.ttse`（读取异常按空字典），runtime 字段覆盖同名 yaml 键，故稀疏 runtime 缓存继承盘上默认、显式 runtime `enabled: false` 仍生效。
  - 文档默认：`enabled: false`、`evolve_enabled`/`inject_enabled`/`dream_enabled` true、`consult_top_k` 8、`consult_retrieve_mode` hybrid；bank 固定 `workspace/.ttse/bank.json`（`_ttse_bank_path` 依已配置 workspace 或默认 agent workspace），注入固定 `disk_catalog`，dream 三参固定 50/24.0/90。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L188–L205](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L188-L205),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8192–L8199](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L8192-L8199),
  - [docs/zh/TTSE.md:L10–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L10-L18), [docs/zh/TTSE.md:L27–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L27-L29)
- **_build_ttse_rail 缺 agent-core 符号、轨迹处理器或构造异常均降级返回 None** `_build_ttse_rail`：TTSERail/TTSEConfig 为 None（agent-core 缺 ttse）时记 warning "TTSERail unavailable: agent-core missing ttse" 返回 None；
  - `get_trajectory_span_processor()` 返回 None 时记 "TTSERail create skipped: TrajectorySpanProcessor unavailable" 返回 None；try 内其余 Exception 记 "TTSERail create failed" 后置 None。`_ensure_ttse_rail_registered` 收到 None 不调用 register_rail，静默返回。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8223–L8330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L8223-L8330),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8458–L8472](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L8458-L8472)
- **TTSE 免 SKILL.md 修改与审批弹窗（推断：免审批为收益、失去审批把关为成本）** 设计推断（非作者历史意图）：
- 文档称 TTSE 与 Skill 正文演进独立：不改 SKILL.md、无审批弹窗；`_build_ttse_rail` 直接构造 TTSEConfig/TTSERail，所示实现无审批环节。推断：收益是轨迹归纳出的 FACT/TIP 免去逐条 Skill 正文修改与审批流程；代价是这些自动条目同样缺少该审批步骤把关。
- 来源：[docs/zh/TTSE.md:L3–L3](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L3-L3),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8223–L8330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L8223-L8330)
- **_ensure_ttse_consult_eager_tool 的启用/禁用既有 helper 单测断言（不覆盖 rail 或 FACT/TIP 本体）** 既有单测：`test_ttse_consult_eager_helper_inserts_when_enabled` 以 {"ttse":{"enabled":true,"inject_enabled":true}} 调 helper，断言 ttse_consult 位于 skill_acceleration_exec 之前；
  - `test_ttse_consult_eager_helper_strips_when_disabled` 以 enabled:false 断言返回列表不含 ttse_consult。源码注明当前 ProgressiveToolRail 用 ToolCard 暴露、该 helper 保留给测试/未来列表调用方，故断言不覆盖 rail 挂载或 FACT/TIP 存储运行时。
- 来源：[tests/unit_tests/agentserver/test_agentserver_modes.py:L2695–L2710](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_agentserver_modes.py#L2695-L2710),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L218–L239](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L218-L239)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-ttse.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TTSE.md:L5-L7；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/eternal_conversation/coordinator.py:L166-L174
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8201-L8221；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TTSE.md:L31-L31
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L188-L205；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8192-L8199
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TTSE.md:L10-L18；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TTSE.md:L27-L29
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8223-L8330；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8458-L8472
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TTSE.md:L3-L3；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_agentserver_modes.py:L2695-L2710
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L218-L239；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TTSE.md:L1-L7
- 源页字段（feature）：ttse
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/interface_deep.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/agents/harness/common/*
