---
name: feature-depth-skill-evolution
description: Skill 自演进实现深读：/evolve 命令契约与 auto_save 审批、react.evolution.skill_evolution/auto_save/review_feedback_min_confidence 默认值、evolutions.json 经验存储与全局 Skill 库、evolution_helpers 的状态响应与超时回退、team_evolution_end_update 单测、watcher 空闲阈值推断
metadata:
  scope: 收 Skill 自演进的文档契约与 evolution_helpers.py 实现级证据，来源另含 interface_deep.py、test_evolution_helpers.py；职责、接口与配置概览归 feature-skill-evolution
---
# Skill 自演进：实现深读

## 现状

- [[feature-skill-evolution]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **`/evolve` 命令契约** `/evolve <skill_name> [user_intent]` 的输入是已安装且对当前 Agent 可见的 Skill 名（可选 user_intent 指明改进意图），系统审查当前任务可用的对话与执行证据后返回“无需演进”或结构化改进提案，发起审查不代表一定生成或保存经验。调用方义务：开启 Skill 自演进，如需展示审批交互还需 `auto_save: false`。提案通过校验后，`auto_save: false` 进入用户审批（展示 target、section、reason、content），`true` 则跳过审批自动保存。
- 来源：[docs/zh/Skill自演进.md:L92–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md#L92-L110),
  - [docs/zh/Skill自演进.md:L112–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md#L112-L125)
- **开关与默认值** `react.evolution.skill_evolution` 默认 `false`，是统一开关，控制 Skill 演进、自动 Skill 创建建议及相关命令和工具的启用；`react.evolution.auto_save` 默认 `false`（YAML-only 高级选项，控制 Single Agent 与 Team Leader 的经验提交是否需用户审批），`react.evolution.review_feedback_min_confidence` 默认 `0.7`。
  - 关闭 `skill_evolution` 会禁用相关 Rails、自检提示、演进工具和 `/evolve` 命令，但不影响用户显式使用通用 `skill-creator` 或 `swarmskill-creator`。
- 来源：[docs/zh/Skill自演进.md:L26–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md#L26-L41),
  - [docs/zh/Skill自演进.md:L43–L43](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md#L43-L43)
- **经验存储与全局 Skill 库的耦合** 经验保存在 Skill 目录下的 `evolutions.json`（~/.jiuwenswarm/agent/workspace/skills/<skill_name>/，首次保存经验时动态创建，无已保存经验时可能不存在）；Agent Team 使用同一个全局 Skill 库，经验仍写入该路径，而成员可见的 Skill 由团队的可见性声明决定。因此团队与单 Agent 的演进经验共享同一物理库，但 Team 场景可演进的目标受 Team Skills 可见性约束。
- 来源：[docs/zh/Skill自演进.md:L174–L185](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md#L174-L185)
- **evolution_status_response：status 为 no_evolution_no_records 的分支返回 answer 类响应** evolve_result.status 去除空白后等于 "no_evolution_no_records" 时取 no_records_output，message 非空则以换行拼接，返回 {"output": 拼接结果, "result_type": "answer"}；status 为空时该本地分支直接返回 None，不做映射。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py:L274–L309](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py#L274-L309)
- **resolve_evolution_event_timeout_sec：SDK 超时读取失败或值非法时回退 fallback** 触发条件：读取 rail.evolution_total_timeout_secs 抛异常、float() 抛 TypeError/ValueError，或值非有限、≤0；各守卫分支返回 fallback（fallback_sec 为 None 时取 TEAM_EVOLUTION_EVENT_TIMEOUT_SEC），异常不向外传播；合法值返回 parsed_timeout + max(grace, 0.0)。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py:L519–L541](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py#L519-L541)
- **team_evolution_end_update 将 failed/timed_out 映射为 hidden 的 helper 单测** 参数化用例（stage 为 "failed"/"timed_out"）直接调用 evolution_helpers.team_evolution_end_update("team_skill_evolve_req1", {"stage": stage, "message": "boom"})，断言返回 update.status == "end"、update.stage == "hidden"、message 保留 "boom"、
  - request_id 不变；断言仅覆盖该 helper 的返回值，未触及 AgentServer 推送链路。
- 来源：[tests/unit_tests/agentserver/test_evolution_helpers.py:L128–L138](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_evolution_helpers.py#L128-L138)
- **演进 watcher 空闲阈值随有效 SDK 超时伸缩，无效值回退 Host 默认** 设计推断（非作者历史意图）：
- rail 存在、signal_trigger 开启且 auto_save 关闭时，watcher 调 resolve_evolution_event_timeout_sec：SDK 超时可转为正有限浮点则加 max(grace,0.0)，读属性抛异常、float 失败或值非有限/≤0 则回退 TEAM_EVOLUTION_EVENT_TIMEOUT_SEC（仅读属性异常分支记 debug 日志）。推断：收益是空闲等待窗口与 SDK 超时对齐；代价是 float 失败与无效值两类回退无日志，且阈值只约束事件间空闲（每批事件重置计时），不是 watcher 总时长上限。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py:L519–L541](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py#L519-L541),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L19328–L19377](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L19328-L19377)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-skill-evolution.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Skill自演进.md:L26-L41；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Skill自演进.md:L43-L43
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Skill自演进.md:L92-L110；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Skill自演进.md:L112-L125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Skill自演进.md:L174-L185；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py:L274-L309
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py:L519-L541；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_evolution_helpers.py:L128-L138
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L19328-L19377
- 源页字段（feature）：skill-evolution
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py；jiuwenswarm/agents/harness/common/rails/*
