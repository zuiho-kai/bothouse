---
name: feature-proactive-recommendation
description: 主动推荐、频率限制与主 Agent 交付功能入口：ProactiveEngine 被 CronScheduler 或立即运行触发、set_proactive_agent/tick_now/reload_config 入口、proactive_recommendation_* 设置字段与一到五十整数、设计推断、proactive_recommendation 消息来源标记、关联阅读及验证步骤
metadata:
  scope: 只收该功能的职责、接口、配置、设计取舍、关联功能与验证；引擎启动装配与 tick 契约的实现级证据归 feature-depth-proactive-recommendation
---
# 主动推荐、频率限制与主 Agent 交付的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-proactive-recommendation.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/proactive_adapter.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/设置与频道升级迁移指南.md
- 源页字段（feature）：proactive-recommendation
- 入口（entry_points）：jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py；jiuwenswarm/server/runtime/proactive_adapter.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py；jiuwenswarm/server/runtime/proactive_adapter.py；jiuwenswarm/agents/harness/common/recommendation/calendar_source.py；jiuwenswarm/agents/harness/common/recommendation/proactive_actions.py
  - jiuwenswarm/agents/harness/common/recommendation/feedback_collector.py；jiuwenswarm/server/agent_ws_server.py；jiuwenswarm/agents/harness/common/recommendation/gradient_updater.py
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/ExperimentalSettings.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/definition.ts
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ProactiveRecommendationCard.tsx；jiuwenswarm/agents/harness/common/recommendation/__init__.py；jiuwenswarm/server/runtime/agent_adapter/interface.py；jiuwenswarm/agents/harness/common/recommendation/proactive_prompts.py
  - jiuwenswarm/agents/harness/common/recommendation/profile_extractor.py；jiuwenswarm/agents/harness/common/recommendation/situation_report.py；jiuwenswarm/channels/web/frontend/src/App.tsx
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- ProactiveEngine 在 AgentServer 作为被外部触发的服务扫描多会话历史与用户 profile，轻量 proactive Agent 决定是否推荐，再经 callback 触发主 Agent 生成话术。引擎本身没有后台 tick 循环；CronScheduler 或立即运行入口触发检查，交付进入主 Agent 上下文和前端流式消息链路。
- 源码与文档：[jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L1-L451)；
  - [jiuwenswarm/server/runtime/proactive_adapter.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L1-L451)；
  - [docs/zh/设置与频道升级迁移指南.md:L1–L211](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%BE%E7%BD%AE%E4%B8%8E%E9%A2%91%E9%81%93%E5%8D%87%E7%BA%A7%E8%BF%81%E7%A7%BB%E6%8C%87%E5%8D%97.md#L1-L211)。

### 接口与调用入口（API）

- 引擎通过 set_proactive_agent、set_trigger_main_agent_callback 和 tick_now 装配与触发；reload_config 更新设置，rebuild_proactive_agent 在模型变化后重建推荐决策 Agent。运行时 adapter 提供 build_proactive_agent、trigger_main_agent 与 init_proactive_engine，将系统触发请求和推荐来源标记接入消息处理。
- 源码与文档：[jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L1-L451)；
  - [jiuwenswarm/server/runtime/proactive_adapter.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L1-L451)；
  - [docs/zh/设置与频道升级迁移指南.md:L1–L211](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%BE%E7%BD%AE%E4%B8%8E%E9%A2%91%E9%81%93%E5%8D%87%E7%BA%A7%E8%BF%81%E7%A7%BB%E6%8C%87%E5%8D%97.md#L1-L211)。

### 配置入口与生效条件

- 设置迁移文档的字段为 proactive_recommendation_enabled、proactive_recommendation_max_recommend_per_day 与 proactive_recommendation_max_rounds_per_tick；引擎内部读取 enabled、max_recommend_per_day 和 max_rounds_per_tick。两个数值支持一到五十的整数，非法手改值会告警并回退；配置段缺失时引擎默认关闭。
- 源码与文档：[jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L1-L451)；
  - [jiuwenswarm/server/runtime/proactive_adapter.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L1-L451)；
  - [docs/zh/设置与频道升级迁移指南.md:L1–L211](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%BE%E7%BD%AE%E4%B8%8E%E9%A2%91%E9%81%93%E5%8D%87%E7%BA%A7%E8%BF%81%E7%A7%BB%E6%8C%87%E5%8D%97.md#L1-L211)。

### 设计取舍

- **设计推断**：轻量 Agent 决策、主 Agent 生成回复让推荐进入已有上下文链路，并共享调度入口；代价是活跃 Agent、历史扫描、每日配额与消息归属必须一起核对。模型设置热更新还要重建推荐 Agent，不能只刷新主 Agent；系统配额提醒可直接通知而不经过模型生成。
- 源码与文档：[jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L1-L451)；
  - [jiuwenswarm/server/runtime/proactive_adapter.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L1-L451)；
  - [docs/zh/设置与频道升级迁移指南.md:L1–L211](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%BE%E7%BD%AE%E4%B8%8E%E9%A2%91%E9%81%93%E5%8D%87%E7%BA%A7%E8%BF%81%E7%A7%BB%E6%8C%87%E5%8D%97.md#L1-L211)。

### 数据流与关联功能

- 调度检查历史与 profile 后选择技能推荐、任务提醒或需求探索，满足频率与可用性条件才触发主 Agent 回复。消息带 proactive_recommendation 来源，帮助区分用户输入与系统触发；Cron 的立即运行沿同一个 proactive.tick 请求入口，避免另造一套检查流程。
- 源码与文档：[jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L1-L451)；
  - [jiuwenswarm/server/runtime/proactive_adapter.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L1-L451)；
  - [docs/zh/设置与频道升级迁移指南.md:L1–L211](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%BE%E7%BD%AE%E4%B8%8E%E9%A2%91%E9%81%93%E5%8D%87%E7%BA%A7%E8%BF%81%E7%A7%BB%E6%8C%87%E5%8D%97.md#L1-L211)。

### 怎样验证

- 检查默认关闭、热启停、非法数值回退和每日配额，再覆盖缺少活跃 Agent、模型设置变更与 callback 失败。核对不同用户和会话的历史归属、Cron 与立即运行入口一致性，以及推荐消息和普通消息的来源标记。本页未执行模型推荐或跨会话集成。
- 源码与文档：[jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/recommendation/proactive_engine.py#L1-L451)；
  - [jiuwenswarm/server/runtime/proactive_adapter.py:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/proactive_adapter.py#L1-L451)；
  - [docs/zh/设置与频道升级迁移指南.md:L1–L211](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%BE%E7%BD%AE%E4%B8%8E%E9%A2%91%E9%81%93%E5%8D%87%E7%BA%A7%E8%BF%81%E7%A7%BB%E6%8C%87%E5%8D%97.md#L1-L211)。
- 关联阅读：[[feature-cron]]（cron）；[[feature-memory]]（memory）；[[feature-models]]（models）；[[feature-web-chat-1]]、[[feature-web-chat-2]]（web-chat）。
