---
name: feature-depth-swarm-skills
description: 团队技能实现深读：compose_member_skill_visibility 解析链、configure_global_skills_dir 默认 ~/.jiuwenswarm/agent/workspace/skills、skills-visibility.json 元数据可见性、allow 并集与 deny 叠加测试
metadata:
  scope: 只收 skills provider 的实现级事实；团队技能概览归 feature-swarm-skills
---
# 团队技能与能力复用：实现深读

## 现状

- [[feature-swarm-skills]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **成员技能可见性的解析链路** compose_member_skill_visibility(ctx) 拿到成员构建上下文后，第一步调用 build_member_skill_visibility_provider(ctx)：它用 ctx.resolve_member_skill_visibility_path() 求出成员可见性文档路径，取不到则返回 None；
  - 随后以成员路径、team_skill_visibility_path 和 team_id 为参数调用 openjiuwen 的 build_skill_visibility_provider 构造一个每次调用都重读元数据文件的 FileSkillVisibilityProvider。回到 compose_member_skill_visibility，provider 为 None 时返回 (set(), 全局禁用集)，否则调用 provider() 得到 (enabled, disabled) 名称集合，供只能接受名称集合的 Skill rail 使用。
- 调用路径：`jiuwenswarm/agents/swarm/providers/skills.py`（`compose_member_skill_visibility`） → `jiuwenswarm/agents/swarm/providers/skills.py`（`build_member_skill_visibility_provider`）
- 来源：[jiuwenswarm/agents/swarm/providers/skills.py:L93–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L93-L115),
  - [jiuwenswarm/agents/swarm/providers/skills.py:L60–L90](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L60-L90)
- **全局技能库目录的指向时机与默认值** enrich_team_spec_for_swarm 在构建任何成员之前调用 configure_global_skills_dir(get_agent_skills_dir())，把 openjiuwen 的唯一 Skill 库指向平台目录，默认路径为 ~/.jiuwenswarm/agent/workspace/skills（get_agent_workspace_dir()/skills）；不调用则 openjiuwen 回退到 ~/.openjiuwen/workspace/skills，两侧读到不同库。
  - 另一处语义默认：skills-visibility.json 中空 allow 列表表示“继承整个库”而非“全部禁用”，且 disabled 恒压过 enabled。
- 来源：[jiuwenswarm/agents/swarm/assembly.py:L313–L318](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/assembly.py#L313-L318),
  - [jiuwenswarm/common/utils.py:L1816–L1824](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/utils.py#L1816-L1824),
  - [jiuwenswarm/agents/swarm/providers/skills.py:L96–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L96-L110)
- **单一物理技能库 + 元数据可见性（而非每成员副本）** 设计推断（非作者历史意图）：
- 推断：技能只存一份物理库，可见性是 skills-visibility.json 元数据，收益是授权变更在运行时生效且跨进程重读即可见；代价是安装不自动扩展 allow-list——空 allow-list 的成员继承全库，而带显式 allow-list 的成员安装新技能后必须被显式授予才可见。模块文档还给出单一 seeder 的理由：第二个写入者会与属主 rail 争抢同一文件锁且跳过规则会漂移。
- 来源：[jiuwenswarm/agents/swarm/providers/skills.py:L18–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L18-L28),
  - [jiuwenswarm/agents/swarm/providers/skills.py:L176–L190](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L176-L190),
  - [jiuwenswarm/agents/swarm/providers/skills.py:L93–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L93-L115)
- **build_member_skill_toolkit：无 workspace 返回 None，正常返回绑定共享库的 rail** Provider 工厂 build_member_skill_toolkit(params, ctx)（注册名 swarm.member_skill_toolkit）不消费任何 params 键，契约上仅为保留签名。MemberSkillToolkitInput.resolve 后若 workspace_root 为空立即返回 None（该成员跳过此能力，调用方必须容忍 None）；
  - 否则返回绑定共享 agent workspace 的 MemberSkillToolkitRail，可见性文档路径仅在构建日志中出现，从不写入。
- 来源：[jiuwenswarm/agents/swarm/providers/skills.py:L176–L225](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L176-L225),
  - [jiuwenswarm/agents/swarm/providers/skills.py:L56–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L56-L57),
  - [jiuwenswarm/agents/swarm/providers/skills.py:L155–L166](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L155-L166)
- **组合语义测试：allow 取并集，deny 并集叠加全局禁用** 入口 tests/agents/swarm/test_skills_provider.py::test_compose_skill_visibility_unions_allow_and_prefers_deny 构造 member（allow=[alpha,shared]、deny=[member-denied]）与 team（allow=[beta,shared]、deny=[team-denied]）两份 SkillVisibility，
  - 调用 openjiuwen 的 compose_skill_visibility(member, team, ["globally-disabled"])，断言 enabled == {alpha,beta,shared}、disabled == {member-denied,team-denied,globally-disabled}。此处仅描述断言内容，不代表该测试此刻已被执行通过。
- 来源：[tests/agents/swarm/test_skills_provider.py:L112–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_skills_provider.py#L112-L130),
  - [tests/agents/swarm/test_skills_provider.py:L27–L34](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_skills_provider.py#L27-L34)
- **skills provider 依赖 openjiuwen 可见性原语；load_execution_disabled_skills 懒导入** providers/skills.py 模块级从 openjiuwen.agent_teams.skill 导入 FileSkillVisibilityProvider/build_skill_visibility_provider，并依赖 MemberSkillToolkitRail 与 SkillManager；
  - _load_global_disabled_skills 延迟导入 jiuwenswarm.server.runtime.skill 的 load_execution_disabled_skills，docstring 注明以免 provider 模块在 import 期拖入 skill 运行时包。
- 来源：[jiuwenswarm/agents/swarm/providers/skills.py:L42–L52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L42-L52),
  - [jiuwenswarm/agents/swarm/providers/skills.py:L118–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L118-L126)
- **build_member_skill_toolkit：workspace_root 为空时返回 None；SkillManager 构建抛异常仅告警并以 manager=None 继续** 触发一：解析出的 workspace_root 为空值，`if not root_path` 守卫直接 return None，该成员跳过技能工具包。触发二：SkillManager(workspace_dir=...) 构建抛异常，被 except Exception 捕获后仅记录 warning，仍返回 manager=None 的 MemberSkillToolkitRail。
- 来源：[jiuwenswarm/agents/swarm/providers/skills.py:L176–L225](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L176-L225)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-swarm-skills.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/skills.py:L93-L115；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/skills.py:L60-L90
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/assembly.py:L313-L318；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/utils.py:L1816-L1824
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/skills.py:L96-L110；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/skills.py:L18-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/skills.py:L176-L190；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/skills.py:L176-L225
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/skills.py:L56-L57；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/skills.py:L155-L166
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_skills_provider.py:L112-L130；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_skills_provider.py:L27-L34
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/skills.py:L42-L52；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/skills.py:L118-L126
- 源页字段（feature）：swarm-skills
- 入口（entry_points）：jiuwenswarm/agents/swarm/assembly.py；jiuwenswarm/agents/swarm/providers/skills.py
- 源页字段（source_globs）：jiuwenswarm/agents/swarm/assembly.py；jiuwenswarm/agents/swarm/providers/skills.py；jiuwenswarm/agents/swarm/*
