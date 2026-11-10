---
name: feature-heartbeat
description: 绑定会话的心跳续跑任务功能入口：按 channel_id 与 session_id 回到原会话续跑、list_jobs/create_job/run_now/cancel_run 等控制入口与 HEARTBEAT_JOB 错误映射、schedule.type interval/cron/once 与 skip/queue/replace 并发策略、终态约束、设计推断、与 Cron 等的关联阅读及验证步骤
metadata:
  scope: 只收该功能的职责、接口、配置、设计取舍、关联功能与验证；controller 与 proxy 的实现级证据归 feature-depth-heartbeat
---
# 绑定会话的心跳续跑任务的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-heartbeat.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/heartbeat/models.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/heartbeat/proxy.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/项目与会话管理.md
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/AGENTS.md
- 源页字段（feature）：heartbeat
- 入口（entry_points）：jiuwenswarm/agents/harness/code/rails/heartbeat/models.py；jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py；jiuwenswarm/gateway/heartbeat/proxy.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/code/rails/heartbeat/models.py；jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py；jiuwenswarm/gateway/heartbeat/proxy.py；jiuwenswarm/agents/harness/code/rails/heartbeat/tools.py
  - jiuwenswarm/channels/web/frontend/src/utils/heartbeatAutomation.ts；jiuwenswarm/agents/harness/code/rails/heartbeat/cron_schedule.py；jiuwenswarm/agents/harness/code/rails/heartbeat/execution.py；jiuwenswarm/channels/web/frontend/src/types/heartbeat.ts
  - jiuwenswarm/agents/harness/code/rails/heartbeat/__init__.py；jiuwenswarm/server/agent_ws_server.py；jiuwenswarm/agents/harness/code/rails/heartbeat/store.py；jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatPagination.tsx
  - jiuwenswarm/agents/harness/code/rails/heartbeat_rail.py；jiuwenswarm/agents/harness/code/rails/heartbeat/runtime.py；jiuwenswarm/runtime/service.py；jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py；jiuwenswarm/agents/harness/code/rails/heartbeat/session_resolver.py
  - jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatStatusBadge.tsx；jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/heartbeatStatusText.ts；jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/index.tsx
  - jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py；jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatScheduleEditor.tsx；jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatTaskDrawer.tsx
  - jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/heartbeatCronValidation.ts；jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/heartbeatScheduleConvert.ts；jiuwenswarm/gateway/channel_manager/tui/tui_connect.py
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- 新 Heartbeat 是绑定 channel_id 与 session_id 的 follow-up 触发器，按调度回到原会话继续上下文；models 定义任务状态，controller 管理操作，Gateway proxy 通过 E2A 转发到 AgentServer。旧 HEARTBEAT.md 全局探活属于健康检查路径，不能把两者的配置和生命周期混为同一种任务。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/heartbeat/models.py:L1–L593](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/models.py#L1-L593)；
  - [jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L1–L576](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L1-L576)；
  - [jiuwenswarm/gateway/heartbeat/proxy.py:L1–L214](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/heartbeat/proxy.py#L1-L214)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 接口与调用入口（API）

- 控制入口有 list_jobs、get_job、create_job、update_job、delete_job、toggle_job、preview_job、run_now、cancel_run 与 get_meta。proxy 使用 ReqMethod.HEARTBEAT_JOB，参数包含 action 和 data；后端 BAD_REQUEST、FORBIDDEN、NOT_FOUND、CONFLICT 与 SERVICE_UNAVAILABLE 分别映射成对应客户端异常。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/heartbeat/models.py:L1–L593](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/models.py#L1-L593)；
  - [jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L1–L576](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L1-L576)；
  - [jiuwenswarm/gateway/heartbeat/proxy.py:L1–L214](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/heartbeat/proxy.py#L1-L214)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 配置入口与生效条件

- schedule.type 支持 interval、cron 和 once，任务记录包含 timezone、prompt、max_runs、concurrency_policy 与会话删除策略。并发策略有 skip、queue、replace；metadata.source 区分 agent_tool、web_rpc、tui_rpc 和 schedule_recovery。完成、过期和禁用是终态，enabled 必须为 false 且 next_run_at 为空。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/heartbeat/models.py:L1–L593](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/models.py#L1-L593)；
  - [jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L1–L576](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L1-L576)；
  - [jiuwenswarm/gateway/heartbeat/proxy.py:L1–L214](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/heartbeat/proxy.py#L1-L214)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 设计取舍

- **设计推断**：在原会话续跑保留上下文和交付归属，代价是调度必须处理忙会话、删除和重复触发。显式并发与会话删除策略让这些情况可检查，但持久任务状态、实际运行和下一次时间需要一起观察；终态记录仍存在不代表任务会继续调度。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/heartbeat/models.py:L1–L593](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/models.py#L1-L593)；
  - [jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L1–L576](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L1-L576)；
  - [jiuwenswarm/gateway/heartbeat/proxy.py:L1–L214](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/heartbeat/proxy.py#L1-L214)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 数据流与关联功能

- 工具或 Web、TUI 请求创建会话心跳，调度器投递 prompt 后更新执行和下次运行状态，控制操作可预览、立即运行或取消当前运行。该能力与 Cron 的日程语义相关，但新增的原线程续跑语义需要独立验证；目标追求也不等同于一个周期探活文件。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/heartbeat/models.py:L1–L593](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/models.py#L1-L593)；
  - [jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L1–L576](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L1-L576)；
  - [jiuwenswarm/gateway/heartbeat/proxy.py:L1–L214](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/heartbeat/proxy.py#L1-L214)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 怎样验证

- 覆盖 interval、cron、once、时区和非法参数，再测试忙会话的三种并发策略、资源限额、会话删除和调度恢复。检查完成及禁用后的 next_run_at，并验证错误映射和不同用户的任务访问边界。本页未执行上游调度或多进程集成测试。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/heartbeat/models.py:L1–L593](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/models.py#L1-L593)；
  - [jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L1–L576](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L1-L576)；
  - [jiuwenswarm/gateway/heartbeat/proxy.py:L1–L214](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/heartbeat/proxy.py#L1-L214)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。
- 关联阅读：[[feature-cron]]（cron）；[[feature-goal-mode]]（goal-mode）；[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（projects-sessions）；[[feature-tui]]（tui）。
