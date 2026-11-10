---
name: feature-goal-mode
description: 持续目标（Goal）与会话控制功能知识入口：goalStore 与 goalModeGate 的职责及 Goal 与 Plan 互斥，evaluateGoalArm/applyGoalArm 与 command.goal 的 get/pause/clear 及 set/resume 流式命令，请求字段与 pendingAction 控制状态，设计取舍、目标事件数据流与验收步骤，并链接 plan-mode、web-chat、projects-sessions、heartbeat
metadata:
  scope: 只收持续目标的功能概览与六个 facet 摘要；闸门调用链、command.goal 两种请求形态、runtime.accepted 处理与 sessionInput 测试断言等实现细节归 feature-depth-goal-mode，Web 前端 owner 级架构归 knowledge-web-frontend
---
# 持续目标与会话控制的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-goal-mode.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/webClient.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Harness.md；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/AGENTS.md
- 源页字段（feature）：goal-mode
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts；jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts；jiuwenswarm/channels/web/frontend/src/services/webClient.ts；jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts；jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts；jiuwenswarm/channels/web/frontend/src/services/webClient.ts；jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts
  - jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/channels/web/frontend/src/components/GoalBar/GoalBar.css；jiuwenswarm/channels/web/frontend/src/components/GoalBar/index.tsx；jiuwenswarm/server/runtime/agent_adapter/interface.py
  - jiuwenswarm/channels/web/frontend/src/components/GoalBar/GoalCompletedCard.tsx；jiuwenswarm/channels/web/frontend/src/components/GoalBar/goalCompletedMessage.ts；jiuwenswarm/channels/web/frontend/src/components/GoalBar/EditGoalModal.tsx
  - jiuwenswarm/channels/web/frontend/src/components/GoalBar/OverwriteGoalConfirmModal.tsx；jiuwenswarm/channels/web/frontend/src/types/goal.ts；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/slashCommands/registry.ts
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/slashCommands/semantics.ts；jiuwenswarm/channels/web/frontend/src/App.tsx；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InputArea.tsx
  - jiuwenswarm/channels/web/frontend/src/features/goalPendingObjectiveBubble.ts；jiuwenswarm/channels/web/frontend/src/stores/chatStore.ts
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- 持续目标用会话级 goalStore 保存目标与请求状态，图形菜单和斜杠命令共用 goalModeGate，WebSocket 事件恢复后端权威记录。目标设置开关与已创建的目标是不同状态；未完成 Goal 与已提交 Plan 互斥，刚打开但尚未提交的 Plan 可在进入目标准备态时关闭。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L1–L220](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L1-L220)；
  - [jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts#L1-L401)；
  - [jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L1–L799](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L1-L799)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 接口与调用入口（API）

- evaluateGoalArm 与 applyGoalArm 统一判断并更新目标开关；requestGoalAction 通过 command.goal 执行 get、pause、clear，sendGoalStreamCommand 执行 set、resume。后两种动作使用流式事件，由 goal.snapshot 和 goal.updated 更新记录，不能等一个不会到来的普通 res 响应作为成功条件。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L1–L220](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L1-L220)；
  - [jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts#L1-L401)；
  - [jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L1–L799](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L1-L799)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 配置入口与生效条件

- 请求使用 session_id、action 与当前 mode，set 携带 objective，流式入口可携带 model_name。界面状态按 session 分离，hasPendingGoalAction 表示请求尚未回执，isGoalSessionBusy 还包含目标 active 和会话执行、暂停、待回答状态；这些是控制状态而非持久全局设置。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L1–L220](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L1-L220)；
  - [jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts#L1-L401)；
  - [jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L1–L799](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L1-L799)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 设计取舍

- **设计推断**：统一开关判断可避免菜单、目标标签和命令入口绕过同一限制，代价是必须区分请求等待与执行忙态。轻量清除入口在 active 时受保护，GoalBar 的正式编辑、暂停和删除只用 pendingAction 防重复；把所有按钮都按 active 禁用会使用户无法主动停止跑偏目标。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L1–L220](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L1-L220)；
  - [jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts#L1-L401)；
  - [jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L1–L799](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L1-L799)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 数据流与关联功能

- 目标正文经 set 创建并驱动当前会话持续执行，用户可暂停、恢复或明确删除。目标事件与聊天正文独立推送，完成状态可能先于回复内容到达；刷新恢复及查询兜底应依据后端目标记录，不能由第一条聊天 delta 猜测目标已经开始或结束。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L1–L220](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L1-L220)；
  - [jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts#L1-L401)；
  - [jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L1–L799](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L1-L799)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 怎样验证

- 分别通过菜单、标签和斜杠命令设置目标，覆盖普通任务执行中、已提交 Plan、等待回答及未完成目标冲突。重点验证 active 但尚无聊天 delta 的窗口、GoalBar 正式暂停删除、重复点击、事件乱序和刷新恢复。本页未运行上游浏览器或持续目标集成测试。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L1–L220](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L1-L220)；
  - [jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts#L1-L401)；
  - [jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L1–L799](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L1-L799)；
  - [jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。
- 关联阅读：[[feature-plan-mode]]（plan-mode）；[[feature-web-chat-1]]、[[feature-web-chat-2]]（web-chat）；[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（projects-sessions）；[[feature-heartbeat]]（heartbeat）。
