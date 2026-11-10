---
name: feature-depth-subagents
description: 子代理派发与验证实现深读：statusline 子代理构造链、code_agent 复用 CodingMemoryRail、CompatibleSubagentControl.resume 的 PENDING_INIT 改写、BrowserAgentInput 默认值与路由放行单测
metadata:
  scope: 只收子代理 provider 与兼容控制的实现级事实；职责与验证方法的概览归 feature-subagents
---
# 子代理派发与验证：实现深读

## 现状

- [[feature-subagents]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **statusline 子代理构造链** 成员装配时，工厂 build_statusline_setup_agent(factory_kwargs, ctx) 先从 ctx.extras["_parent_model"] 读取父成员模型；
  - 模型存在时调用 build_statusline_setup_agent_config(model, workspace=..., sys_operation=parent_sys_operation(ctx), ...)，后者构造并返回带 AgentCard(id="jiuwenswarm.statusline-setup")、rails=[SysOperationRail()]、enable_task_loop=False 的 SubAgentConfig，并置 spec.factory_kwargs={"auto_create_workspace": False}。
- 调用路径：`jiuwenswarm/agents/swarm/providers/code_subagents.py`（`build_statusline_setup_agent`） → `jiuwenswarm/server/runtime/agent_adapter/statusline_setup_agent.py`（`build_statusline_setup_agent_config`）
- 来源：[jiuwenswarm/agents/swarm/providers/code_subagents.py:L137–L154](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_subagents.py#L137-L154),
  - [jiuwenswarm/server/runtime/agent_adapter/statusline_setup_agent.py:L89–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/statusline_setup_agent.py#L89-L119)
- **code_agent 复用共享 CodingMemoryRail** build_code_agent 从 ctx.extras[CODING_MEMORY_EXTRAS_KEY] 取主代理的 CodingMemoryRail 实例；由于向 build_code_agent_config 传 rails 会覆盖默认，必须显式把 SysOperationRail() 与共享 rail 一起传入，否则 code_agent 会丢失系统操作工具。这是 swarm 成员与主代理记忆一致的耦合点。
- 来源：[jiuwenswarm/agents/swarm/providers/code_subagents.py:L111–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_subagents.py#L111-L126)
- **rails 覆盖必须显式携带默认项** 设计推断（非作者历史意图）：
- 推断：build_code_agent 向 build_code_agent_config 传 rails 时会整体覆盖默认 rail 集，因此共享的 CodingMemoryRail 必须与 SysOperationRail() 一起显式传入；收益是子代理复用主代理的编码记忆，代价是任何新增默认 rail 都要同步维护这里的列表，否则静默丢失。
- 来源：[jiuwenswarm/agents/swarm/providers/code_subagents.py:L111–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_subagents.py#L111-L126)
- **CompatibleSubagentControl.resume(subagent_id)：仅当已恢复、状态为 PENDING_INIT 且找到实例时才改写返回状态** 先 await super().resume(subagent_id)；若 not restored、result.status.kind 非 PENDING_INIT，或 self._manager.find(subagent_id) 为 None，则原样返回 super() 的结果。
  - 找到实例后若实时 agent_status() 已非 PENDING_INIT，返回 replace(result, status=current)；仍为 PENDING_INIT 时才 await instance.status.set(SubagentStatus.completed()) 并返回 replace(result, status=idle)（行内注释：COMPLETED 映射为公开 idle 态）。
- 来源：[jiuwenswarm/agents/harness/common/tools/subagent_compat.py:L23–L43](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/subagent_compat.py#L23-L43)
- **BrowserAgentInput 默认值：max_iterations、language 缺省 en、workspace_root 缺省 ./** max_iterations 默认 DEFAULT_BROWSER_AGENT_MAX_ITERATIONS；language 由 code_runtime_language 解析、缺省 "en"；workspace_root 由 _workspace_root 解析、缺省 "./"；session_id 取自构建上下文，模块 docstring 称由其派生的 browser_key 让每个成员获得独立浏览器。
- 来源：[jiuwenswarm/agents/swarm/providers/code_subagents.py:L157–L174](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_subagents.py#L157-L174),
  - [jiuwenswarm/agents/swarm/providers/code_subagents.py:L12–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_subagents.py#L12-L17)
- **resume 未恢复、非 PENDING_INIT 或找不到实例时原样透传** 触发：not result.restored 或状态非 PENDING_INIT，或 self._manager.find(subagent_id) 返回 None；对应守卫分支直接返回原 result，不做 idle 改写，也不在此抛出异常。
- 来源：[jiuwenswarm/agents/harness/common/tools/subagent_compat.py:L24–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/subagent_compat.py#L24-L33)
- **helper 单测：terminal_internal_route 对 subagent 控制 tool 的条件放行** 断言仅覆盖判定 helper：subagent_runtime_control_verified=True 时 terminal_internal_route 对 subagent_list/send_input/close/resume 返回 level=='allow'、reason=='canonical_internal_action_allow'；未传该证明时对 subagent_list 返回 None。facts 为直接构造，未运行真实子代理派发。
- 来源：[tests/unit_tests/agentserver/permissions/test_auto_decision.py:L130–L148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_auto_decision.py#L130-L148),
  - [tests/unit_tests/agentserver/permissions/test_auto_decision.py:L217–L222](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_auto_decision.py#L217-L222)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-subagents.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/code_subagents.py:L111-L126；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/code_subagents.py:L137-L154
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/statusline_setup_agent.py:L89-L119；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/code_subagents.py:L157-L174
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/code_subagents.py:L12-L17；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/subagent_compat.py:L24-L33
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/subagent_compat.py:L23-L43；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_auto_decision.py:L130-L148
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_auto_decision.py:L217-L222
- 源页字段（feature）：subagents
- 入口（entry_points）：jiuwenswarm/agents/swarm/providers/code_subagents.py；jiuwenswarm/agents/harness/common/tools/subagent_compat.py
- 源页字段（source_globs）：jiuwenswarm/agents/swarm/providers/code_subagents.py；jiuwenswarm/agents/harness/common/tools/subagent_compat.py；jiuwenswarm/agents/harness/common/rails/*
