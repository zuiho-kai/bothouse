---
name: feature-swarm-skills
description: 团队技能与能力复用功能概览：enrich_team_spec_for_swarm、preflight_team_mcps、skills / tools 配置键、成员可见性属于团队装配边界与验证步骤
metadata:
  scope: 只收团队技能的职责、接口入口、配置入口、设计取舍与验证方法（guide）；成员技能可见性解析、全局技能库目录与组合语义测试归 feature-depth-swarm-skills；单 Agent 技能归 feature-skills
---
# 团队技能与能力复用 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-swarm-skills.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/assembly.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/skills.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/SwarmSkills.md
- 源页字段（feature）：swarm-skills
- 入口（entry_points）：jiuwenswarm/agents/swarm/assembly.py；jiuwenswarm/agents/swarm/providers/skills.py
- 源页字段（source_globs）：jiuwenswarm/agents/swarm/assembly.py；jiuwenswarm/agents/swarm/providers/skills.py；jiuwenswarm/agents/swarm/*；jiuwenswarm/agents/swarm/config_specs.py；jiuwenswarm/agents/swarm/providers/tools.py
  - jiuwenswarm/resources/agent/workspace/skills/swarmskill-creator/scripts/validate_swarmskill.py；jiuwenswarm/server/runtime/agent_adapter/team_helpers.py；jiuwenswarm/agents/harness/team/rails/team_skill_storage_policy_rail.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 团队技能将角色、协作流程和依赖组织成可复用的能力包。它的绑定与成员可见性属于团队装配边界，不能简单按单 Agent 的 SKILL.md 解释。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/swarm/assembly.py:L1–L487](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/assembly.py#L1-L487)；
  - [jiuwenswarm/agents/swarm/providers/skills.py:L1–L233](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L1-L233)；
  - [docs/zh/SwarmSkills.md:L1–L943](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/SwarmSkills.md#L1-L943)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `enrich_team_spec_for_swarm(spec, session_id, mode, project_dir, trusted_dirs, request_id, user_id, …)`；`preflight_team_mcps(spec)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/swarm/assembly.py:L1–L487](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/assembly.py#L1-L487)；
  - [jiuwenswarm/agents/swarm/providers/skills.py:L1–L233](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L1-L233)；
  - [docs/zh/SwarmSkills.md:L1–L943](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/SwarmSkills.md#L1-L943)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `skills`、`tools`。这些是示例字段，不单独证明源码默认值或全部优先级。 实现中直接读取的环境变量名称包括 `TEAM_EVENT_GATEWAY_WS_URL`、`GATEWAY_PORT`、`WEB_PORT`、`WEB_PATH`；名称与实际部署值分开核对。 文档中的调用选项包括 `--version`、`--type`、`--token`、`--force`、`--system-token`、`--output`，适用命令与前置条件沿文档确认。
  - 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/agents/swarm/assembly.py:L1–L487](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/assembly.py#L1-L487)；
  - [jiuwenswarm/agents/swarm/providers/skills.py:L1–L233](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L1-L233)；
  - [docs/zh/SwarmSkills.md:L1–L943](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/SwarmSkills.md#L1-L943)。

### 设计取舍

- **设计推断**：团队技能把角色、协作顺序和失败处理封装成 SOP，利于重复任务复用；代价是成员配置、依赖和结果契约必须与当前 Team 装配匹配。它比单 Agent 技能多一层协调语义，不能只检查一个 SKILL.md 是否存在就断言整包可运行。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/swarm/assembly.py:L1–L487](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/assembly.py#L1-L487)；
  - [jiuwenswarm/agents/swarm/providers/skills.py:L1–L233](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L1-L233)；
  - [docs/zh/SwarmSkills.md:L1–L943](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/SwarmSkills.md#L1-L943)。

### 数据流与关联功能

- 团队技能将角色、协作流程和依赖组织成可复用的能力包。它的绑定与成员可见性属于团队装配边界，不能简单按单 Agent 的 SKILL.md 解释。 联调时结合[[feature-team]]（多智能体团队协作）、[[feature-skills]]（技能安装、挂载与发现）、[[feature-swarmflow]]（SwarmFlow 工作流与 HITL）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/swarm/assembly.py:L1–L487](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/assembly.py#L1-L487)；
  - [jiuwenswarm/agents/swarm/providers/skills.py:L1–L233](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L1-L233)；
  - [docs/zh/SwarmSkills.md:L1–L943](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/SwarmSkills.md#L1-L943)。

### 怎样验证

- 选择包含多个角色的团队技能，核对绑定后的成员、工作流、输入输出和汇总结果。覆盖成员不可用、缺少输入与失败处理，再检查技能更新后新团队是否使用预期角色和约束。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/swarm/assembly.py:L1–L487](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/assembly.py#L1-L487)；
  - [jiuwenswarm/agents/swarm/providers/skills.py:L1–L233](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/skills.py#L1-L233)；
  - [docs/zh/SwarmSkills.md:L1–L943](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/SwarmSkills.md#L1-L943)。
