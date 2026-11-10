---
name: feature-ttse
description: FACT/TIP 双轨经验（TTSE）知识入口：从轨迹归纳环境事实与能力提示的职责、_ensure_ttse_rail_registered 与 ttse_consult 入口、react.ttse.enabled 等配置键（仅 agent 模式挂载）、设计取舍、关联功能与验收步骤
metadata:
  scope: 只收职责、接口、配置、取舍、数据流与验证摘要；挂载条件、参数解析、合并优先级与降级细节归 feature-depth-ttse，技能正文演进归 feature-skill-evolution
---
# FACT/TIP 双轨经验 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-ttse.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TTSE.md
- 源页字段（feature）：ttse
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/interface_deep.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/agents/harness/common/*
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- TTSE 从轨迹归纳环境事实与能力提示，独立于修改技能正文的演进。模式装配、轨迹采集、检索与注入共同决定经验是否被本轮使用。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/TTSE.md:L1–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L1-L31)。

### 接口与调用入口（API）

- Host 的 `_update_rails_for_mode` 与 `_ensure_ttse_rail_registered`/`_unconfigure_ttse_rail`控制 rail 的生命周期。`ttse_consult(category=…, query=…)` 用于检索，两项都必须填写；查询全集采用 `category=all`。调用的是 agent-core 提供的 rail，缺少此依赖时 Host 会跳过挂载，不能把源码有分支写成环境中已经可用。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/TTSE.md:L1–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L1-L31)。

### 配置入口与生效条件

- `react.ttse.enabled` 控制 Host 挂载，模板默认关闭且只在 agent 模式生效；code/team 不挂载。`evolve_enabled` 与 `inject_enabled` 分别控制归纳和注入，`dream_enabled` 控制经验库整理，`consult_retrieve_mode` 选择 hybrid/embed/bm25。这些配置在 TTSE 文档中明确列出；bank 路径、注入方式和 dream 时间常量不是用户配置项。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/TTSE.md:L1–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L1-L31)。

### 设计取舍

- **设计推断**：FACT 与 TIP 独立沉淀，不修改 SKILL.md 或弹技能演进审批，降低正文演进的耦合；代价是经验目录、consult 检索和 prompt 注入必须一起工作。Host 自动启用所需轨迹采集，但缺少 agent-core Rail 时会跳过挂载，配置启用不等于已经具备依赖。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/TTSE.md:L1–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L1-L31)。

### 数据流与关联功能

- TTSE 从轨迹归纳环境事实与能力提示，独立于修改技能正文的演进。模式装配、轨迹采集、检索与注入共同决定经验是否被本轮使用。 联调时结合[[feature-skill-evolution]]（Skill 自演进）、[[feature-memory]]（长期记忆）、[[feature-observability]]（执行轨迹与保留）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/TTSE.md:L1–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L1-L31)。

### 怎样验证

- 在 Agent 模式开启后核对 Rail 与轨迹采集，运行可归纳事实的任务再查询 FACT 和 TIP。分别关闭归纳、注入和 dream，检查各阶段独立生效；验证 Code/Team 不挂载以及缺少 Rail 依赖时的降级行为。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/TTSE.md:L1–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TTSE.md#L1-L31)。
