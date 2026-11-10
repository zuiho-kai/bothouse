---
name: feature-skill-evolution
description: Skill 自演进知识入口：演进链路与候选生成/审批/装载的阶段区分、EvolutionPushContext 等 evolution_helpers 定位入口、react.evolution.skill_evolution 与 auto_save 示例配置键、设计取舍、关联功能与验收步骤
metadata:
  scope: 只收职责、接口、配置、取舍、数据流与验证摘要，不证明源码默认值；/evolve 契约、默认值与超时回退等细节归 feature-depth-skill-evolution，TTSE 经验归 feature-ttse
---
# Skill 自演进 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-skill-evolution.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Skill自演进.md
- 源页字段（feature）：skill-evolution
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py；jiuwenswarm/agents/harness/common/rails/*；jiuwenswarm/gateway/message_handler/evolution_approval.py；jiuwenswarm/gateway/message_handler/message_handler.py
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/evolution-status.ts；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/runtime/evolution.py；jiuwenswarm/server/runtime/skill/skill_manager.py
  - jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useEvolution.ts；jiuwenswarm/channels/web/frontend/src/features/SkillEvolutionModal/index.tsx；jiuwenswarm/agents/swarm/providers/evolution_rails.py；jiuwenswarm/server/runtime/agent_adapter/team_helpers.py
  - jiuwenswarm/agents/harness/team/team_manager.py；jiuwenswarm/channels/tui/frontend/src/app-state.ts
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 演进链路利用执行经验改进技能内容。候选生成、审批或安装以及运行中的技能装载属于不同阶段，不能把生成候选写成已经生效。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py:L1–L892](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py#L1-L892)；
  - [docs/zh/Skill自演进.md:L1–L376](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md#L1-L376)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `EvolutionPushContext`；`EvolutionStatusUpdate`；`EvolutionProgressStatus`；`read_skill_kind(store, skill_name)`；`validate_evolution_skill(store, skill_name, require_skill_md)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py:L1–L892](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py#L1-L892)；
  - [docs/zh/Skill自演进.md:L1–L376](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md#L1-L376)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `react.evolution.skill_evolution`、`react.evolution.auto_save`。这些是示例字段，不单独证明源码默认值或全部优先级。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py:L1–L892](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py#L1-L892)；
  - [docs/zh/Skill自演进.md:L1–L376](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md#L1-L376)。

### 设计取舍

- **设计推断**：运行经验先作为可管理的经验记录保存，减少每次立即改写 SKILL.md 的扰动；代价是提案、审批、保存、加载与重建必须区分。Single Agent、Leader 和 Teammate 走不同触发链，不能把一次错误或纠正解释为必然生成并自动生效的演进。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py:L1–L892](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py#L1-L892)；
  - [docs/zh/Skill自演进.md:L1–L376](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md#L1-L376)。

### 数据流与关联功能

- 演进链路利用执行经验改进技能内容。候选生成、审批或安装以及运行中的技能装载属于不同阶段，不能把生成候选写成已经生效。 联调时结合[[feature-skills]]（技能安装、挂载与发现）、[[feature-ttse]]（FACT/TIP 双轨经验）、[[feature-team]]（多智能体团队协作）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py:L1–L892](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py#L1-L892)；
  - [docs/zh/Skill自演进.md:L1–L376](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md#L1-L376)。

### 怎样验证

- 用可复现的技能问题生成提案，检查自动保存关闭时的审批和拒绝，再核对保存记录与下次加载。覆盖主动 evolve、经验查看整理、重建回滚和 Team reviewer feedback，验证不同角色的触发边界。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py:L1–L892](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/evolution_helpers.py#L1-L892)；
  - [docs/zh/Skill自演进.md:L1–L376](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Skill%E8%87%AA%E6%BC%94%E8%BF%9B.md#L1-L376)。
