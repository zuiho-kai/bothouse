---
name: feature-skill-development
description: SkillDev 创建、评测与打包边界知识入口：阶段流水线职责与 create_stage_agent 仍抛 NotImplementedError 的现状、skilldev.start/respond/status/download/cancel/file.list/file.read 路由、SkillDevDeps 注入配置、设计取舍、数据流与验证步骤
metadata:
  scope: 只收职责、接口、配置、取舍、数据流与验证六个 facet 的摘要，不证明端到端技能生成可运行；方法分发、默认值、checkpoint 等实现细节归 feature-depth-skill-development，技能自演进归 feature-skill-evolution
---
# SkillDev 创建、评测与打包边界的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-skill-development.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/service.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/pipeline.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/deps.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/context.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md
- 源页字段（feature）：skill-development
- 入口（entry_points）：jiuwenswarm/server/runtime/skill/skilldev/service.py；jiuwenswarm/server/runtime/skill/skilldev/pipeline.py；jiuwenswarm/server/runtime/skill/skilldev/deps.py；jiuwenswarm/server/runtime/skill/skilldev/context.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/skill/skilldev/service.py；jiuwenswarm/server/runtime/skill/skilldev/pipeline.py；jiuwenswarm/server/runtime/skill/skilldev/deps.py；jiuwenswarm/server/runtime/skill/skilldev/context.py
  - jiuwenswarm/channels/web/frontend/src/components/SkillPanel/DocToSkillModal.tsx；jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/scripts/aggregate_benchmark.py；jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/eval-viewer/viewer.html
  - jiuwenswarm/server/runtime/skill/skill_manager.py；jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/scripts/improve_description.py；jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/scripts/run_loop.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/scripts/run_eval.py；jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/eval-viewer/generate_review.py；jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/assets/eval_review.html
  - jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/scripts/quick_validate.py；jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py；jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/prepare_images.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/image_review.py；jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/save_images.py；jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/scripts/utils.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/scripts/generate_report.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/validator.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/scripts/package_skill.py；jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/finalize_scripts.py；jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/common.py
  - jiuwenswarm/server/runtime/skill/skilldev/store.py；jiuwenswarm/server/runtime/skill/skilldev/workspace.py；jiuwenswarm/server/runtime/skill/skilldev/schema.py；jiuwenswarm/server/runtime/skill/skilldev/stages/desc_optimize_stage.py
  - jiuwenswarm/server/runtime/skill/skilldev/stages/evaluate_stage.py；jiuwenswarm/server/runtime/skill/skilldev/stages/generate_stage.py；jiuwenswarm/server/runtime/skill/skilldev/stages/improve_stage.py；jiuwenswarm/server/runtime/skill/skilldev/stages/init_stage.py
  - jiuwenswarm/server/runtime/skill/skilldev/stages/package_stage.py；jiuwenswarm/server/runtime/skill/skilldev/stages/plan_stage.py；jiuwenswarm/server/runtime/agent_adapter/interface.py；jiuwenswarm/server/runtime/skill/skilldev/stages/validate_stage.py
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- SkillDev 的设计将需求、规划、生成、校验、测试、评测、改进、打包与描述优化组织成确定性阶段流水线，service 接收请求，pipeline 编排，deps 提供模型与基础设施。当前固定基线的 context.create_stage_agent 仍抛 NotImplementedError，因此本页描述已存在的服务和设计边界，不宣称端到端技能生成已可运行。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skilldev/service.py:L1–L360](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/service.py#L1-L360)；
  - [jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L1–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L1-L194)；
  - [jiuwenswarm/server/runtime/skill/skilldev/deps.py:L1–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/deps.py#L1-L37)；
  - [jiuwenswarm/server/runtime/skill/skilldev/context.py:L1–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/context.py#L1-L114)；
  - [jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md:L1–L701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md#L1-L701)。

### 接口与调用入口（API）

- SkillDevService.handle 接收 AgentRequest 并输出 AgentResponseChunk 流，路由 skilldev.start、respond、status、download、cancel、file.list 与 file.read。respond 根据已持久任务的挂起阶段恢复流水线，status 可查询单项或任务列表；download 检查已打包路径和实际文件后返回 content_base64。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skilldev/service.py:L1–L360](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/service.py#L1-L360)；
  - [jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L1–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L1-L194)；
  - [jiuwenswarm/server/runtime/skill/skilldev/deps.py:L1–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/deps.py#L1-L37)；
  - [jiuwenswarm/server/runtime/skill/skilldev/context.py:L1–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/context.py#L1-L114)；
  - [jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md:L1–L701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md#L1-L701)。

### 配置入口与生效条件

- SkillDevDeps 注入 model_name、model_client_config、mcp_tools_factory、sysop_config、state_store 与 workspace_provider，任务使用 task_id 关联状态和工作区。入口设计区分仅需求、携带 resources 与 existing_skill 修改模式；这些字段应沿当前 service 与阶段实现核对，不能直接复制设计文档旧 agentserver 路径当成现行配置。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skilldev/service.py:L1–L360](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/service.py#L1-L360)；
  - [jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L1–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L1-L194)；
  - [jiuwenswarm/server/runtime/skill/skilldev/deps.py:L1–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/deps.py#L1-L37)；
  - [jiuwenswarm/server/runtime/skill/skilldev/context.py:L1–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/context.py#L1-L114)；
  - [jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md:L1–L701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md#L1-L701)。

### 设计取舍

- **设计推断**：确定性阶段与独立状态存储便于挂起、审阅和恢复，但要求 checkpoint、工作区与阶段输出同步。单一 respond 入口把不同确认动作交给阶段语义，减少请求种类，却需要验证允许动作；阶段 Agent 的未实现接入是当前基线限制，不能用设计中的完整流程替代运行证据。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skilldev/service.py:L1–L360](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/service.py#L1-L360)；
  - [jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L1–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L1-L194)；
  - [jiuwenswarm/server/runtime/skill/skilldev/deps.py:L1–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/deps.py#L1-L37)；
  - [jiuwenswarm/server/runtime/skill/skilldev/context.py:L1–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/context.py#L1-L114)；
  - [jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md:L1–L701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md#L1-L701)。

### 数据流与关联功能

- 设计流程在规划确认、评测审阅和描述优化处向前端发事件，打包产物可通过下载与文件接口交付。已有 service 将阶段事件变为响应 chunk，但真实模型阶段仍受 context 占位实现限制；它与安装现成技能、检索技能和从任务经验自演进属于不同能力边界。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skilldev/service.py:L1–L360](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/service.py#L1-L360)；
  - [jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L1–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L1-L194)；
  - [jiuwenswarm/server/runtime/skill/skilldev/deps.py:L1–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/deps.py#L1-L37)；
  - [jiuwenswarm/server/runtime/skill/skilldev/context.py:L1–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/context.py#L1-L114)；
  - [jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md:L1–L701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md#L1-L701)。

### 怎样验证

- 先检查请求路由、缺失 task_id、非挂起状态的 respond、checkpoint 与工作区文件接口，再确认下载前真实产物存在。端到端验证必须先接入阶段 Agent，覆盖每个暂停恢复点、失败与取消；本页没有执行上游 SkillDev 流水线，也没有把蓝图当成已通过的功能。
- 源码与文档：[jiuwenswarm/server/runtime/skill/skilldev/service.py:L1–L360](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/service.py#L1-L360)；
  - [jiuwenswarm/server/runtime/skill/skilldev/pipeline.py:L1–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/pipeline.py#L1-L194)；
  - [jiuwenswarm/server/runtime/skill/skilldev/deps.py:L1–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/deps.py#L1-L37)；
  - [jiuwenswarm/server/runtime/skill/skilldev/context.py:L1–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/context.py#L1-L114)；
  - [jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md:L1–L701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/skill/skilldev/DESIGN.md#L1-L701)。
- 关联阅读：[[feature-skills]]（skills）；[[feature-skill-evolution]]（skill-evolution）；[[feature-artifacts]]（artifacts）；[[feature-auto-harness]]（auto-harness）。
