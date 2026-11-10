---
name: feature-depth-team
description: 多智能体团队协作实现深读：team_observability 与 trajectory_ui 默认值、trajectory sink 的 demand 引用计数、观测初始化与 A2X 空白注册失败差异、成员 rail 角色分化测试、get_or_create_team 与 get_team_agent
metadata:
  scope: 收 team_manager.py 的实现级事实，来源另含 a2x_registry_runtime.py、config.py、runtime.py、test_team_runtime_inheritance.py；团队协作的职责、接口入口、配置与验证概览归 feature-team
---
# 多智能体团队协作：实现深读

## 现状

- [[feature-team]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **team_observability 与 trajectory_ui 的默认值与联动** team_observability.enabled 默认 False，但只要 trajectory_ui.enabled 为真或 skill/symphony evolution 开启（get_skill_evolution_enabled 严格判定 react.evolution.skill_evolution is True），provider 就会被拉起；traces_dir 缺省为用户工作区下的 .trace 目录。
  - trajectory_ui 各数值字段走保守默认（如 enabled 默认 False），老配置缺该节时数据面保持关闭。
- 来源：[jiuwenswarm/agents/harness/team/team_manager.py:L130–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L130-L209),
  - [jiuwenswarm/common/config.py:L299–L301](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L299-L301),
  - [jiuwenswarm/observability/config.py:L112–L154](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/config.py#L112-L154)
- **对进程级 trajectory 运行时的按需求引用计数** 团队观测与单 Agent 共享同一个进程级 trajectory sink：shutdown_team_observability 以 demand="team" 调 shutdown_trajectory_runtime，后者先从 _runtime_demands 移除该 demand，若仍有其他需求方则直接返回 True 不排空 sink。这保证 Team 关闭观测不会拆掉其他运行时仍在使用的轨迹落盘通道。
- 来源：[jiuwenswarm/agents/harness/team/team_manager.py:L212–L227](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L212-L227),
  - [jiuwenswarm/observability/runtime.py:L124–L136](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/runtime.py#L124-L136)
- **观测初始化失败与空白注册失败的传播差异** sync_team_observability 初始化失败时：若 evolution 请求了 provider，则抛 RuntimeError("Team evolution observability initialization failed") 阻断；否则仅记 warning 并把 _observability_active 置 False 降级继续。启动期 A2X 空白注册对超时/异常一律 best-effort：记 warning 后返回 False，且 finally 中关闭客户端也再包一层 2 秒超时。
- 来源：[jiuwenswarm/agents/harness/team/team_manager.py:L178–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L178-L209),
  - [jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L254–L283](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py#L254-L283)
- **轨迹 sink 的 demand 引用计数：跨运行时共存收益，代价是 drain 推迟到无人持有 demand** 选择：进程级轨迹 sink 按 demand 计数共享，shutdown_team_observability 以 demand="team" 调用 shutdown_trajectory_runtime（216），后者 discard 该 demand 后若 _runtime_demands 仍非空直接 return True 而不 drain，
  - 只有最后一个 demand 释放才走 _shutdown_locked（observability/runtime.py 130–136）。收益（docstring 写明）：Team tracing 保留自己的 demand，禁用 Team 观测不会拆掉其他运行时仍在用的轨迹 sink（141–144）；代价：真正的 drain 与关闭被推迟到没有任何 demand 持有为止。
- 来源：[jiuwenswarm/agents/harness/team/team_manager.py:L141–L144](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L141-L144),
  - [jiuwenswarm/agents/harness/team/team_manager.py:L212–L219](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L212-L219),
  - [jiuwenswarm/observability/runtime.py:L130–L136](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/runtime.py#L130-L136)
- **test_build_member_rails_omits_task_planning_for_leader_only：断言成员 rail 按角色分化** pytest 入口 tests/unit_tests/agentserver/test_team_runtime_inheritance.py::test_build_member_rails_omits_task_planning_for_leader_only（168–181）分别以 role="leader" 与 role="teammate"、
  - runtime=RuntimeInfo(language="cn") 调用 build_member_rails 两次，断言 leader 的 rails 中不存在 TaskPlanningRail 而 teammate 的存在，且两者均不含 HeartbeatRail——检验成员 rail 装配的角色分化行为。此处仅陈述测试断言内容，不声明这些测试当前已运行通过。
- 来源：[tests/unit_tests/agentserver/test_team_runtime_inheritance.py:L168–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_team_runtime_inheritance.py#L168-L181)
- **get_or_create_team：_bootstrap_lock 内命中缓存即返回；未命中先 _destroy_other_sessions 再 create_team** 进入 self._bootstrap_lock 后先取 self._team_agents.get(session_id)，非 None 即原样返回缓存的 TeamAgent；
  - 未命中分支先 await self._destroy_other_sessions(session_id, channel_id)，再 return await self.create_team(session_id, deep_agent, request_id, channel_id, request_metadata)。docstring 限定此缓存仅供分布式 teammate 进程的 remote member bootstrap 使用。
- 来源：[jiuwenswarm/agents/harness/team/team_manager.py:L1735–L1761](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L1735-L1761)
- **get_team_agent(session_id)：_team_agents 的 truthy 值优先，否则回落 _runner_team_agents，可能返回 None** 输入 session_id，方法体仅一行返回 `self._team_agents.get(session_id) or self._runner_team_agents.get(session_id)`：第一张映射查出 truthy 值即短路返回；否则返回第二张映射的 get 结果，两张都未命中时为 None。该方法是只读查询，不创建 TeamAgent，也不做存活检查。
- 来源：[jiuwenswarm/agents/harness/team/team_manager.py:L2179–L2181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L2179-L2181)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-team.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/team_manager.py:L130-L209；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L299-L301
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/config.py:L112-L154；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/team_manager.py:L212-L227
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/runtime.py:L124-L136；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/team_manager.py:L178-L209
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/a2x_registry_runtime.py:L254-L283；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/team_manager.py:L141-L144
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/team_manager.py:L212-L219；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/runtime.py:L130-L136
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_team_runtime_inheritance.py:L168-L181；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/team_manager.py:L1735-L1761
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/team_manager.py:L2179-L2181
- 源页字段（feature）：team
- 入口（entry_points）：jiuwenswarm/agents/harness/team/team_manager.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/team/team_manager.py；jiuwenswarm/agents/harness/team/*.py
