---
name: feature-team
description: 多智能体团队协作（Leader 与 Teammate）功能概览：team_manager.py 入口、sync/shutdown_team_observability、TeamManager 请求跟踪方法、is_team_session_running、配置入口、设计取舍与验证步骤
metadata:
  scope: 只收多智能体团队协作的功能概览（guide）：职责、接口入口、配置入口、取舍、数据流与验证建议；team_observability 默认值、trajectory demand 引用计数、get_or_create_team 等实现级事实归 feature-depth-team
---
# 多智能体团队协作 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-team.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/team_manager.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/AgentTeam.md
- 源页字段（feature）：team
- 入口（entry_points）：jiuwenswarm/agents/harness/team/team_manager.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/team/team_manager.py；jiuwenswarm/agents/harness/team/*.py；jiuwenswarm/agents/swarm/agent_group.py；jiuwenswarm/server/runtime/extension_package_manager.py；jiuwenswarm/agents/harness/team/bootstrap.py；jiuwenswarm/common/config.py
  - jiuwenswarm/channels/ide/packages/vscode-extension/src/swarm/SwarmMapPanel.ts；jiuwenswarm/channels/ide/packages/vscode-extension/src/swarm/SwarmState.ts；jiuwenswarm/channels/ide/packages/vscode-extension/src/swarm/SwarmStateManager.ts
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/swarm/SwarmState.kt；jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/swarm/SwarmStateManager.kt；jiuwenswarm/agents/swarm/providers/tools.py
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt；jiuwenswarm/channels/ide/packages/shared-webview/swarm_map.html
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/SwarmMapPanel.kt；jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/SwarmMapToolWindowFactory.kt；jiuwenswarm/agents/swarm/__init__.py
  - jiuwenswarm/agents/swarm/assembly.py；jiuwenswarm/server/runtime/agent_adapter/team_helpers.py；jiuwenswarm/channels/web/frontend/src/components/teamArea/shared.tsx；jiuwenswarm/server/agent_ws_server.py；jiuwenswarm/server/runtime/team_binding_store.py
  - jiuwenswarm/agents/harness/team/config_loader.py；jiuwenswarm/agents/harness/common/tools/send_file_to_user.py；jiuwenswarm/agents/harness/team/event_types.py；jiuwenswarm/channels/web/frontend/src/components/teamArea/TeamMembersPanel.tsx
  - jiuwenswarm/channels/web/frontend/src/utils/teamMemberAvatar.ts；jiuwenswarm/channels/web/frontend/src/components/TeamMemberAvatar/index.tsx；jiuwenswarm/channels/web/frontend/src/components/teamArea/MemberListItem.tsx
  - jiuwenswarm/channels/web/frontend/src/components/teamArea/MemberOverviewCard.tsx；jiuwenswarm/agents/harness/team/__init__.py；jiuwenswarm/agents/harness/team/handlers/team_monitor_handler.py；jiuwenswarm/agents/harness/team/handlers/base_monitor_handler.py
  - jiuwenswarm/agents/harness/team/rails/team_workspace_report_path_rail.py；jiuwenswarm/agents/harness/team/team_name_generator.py；jiuwenswarm/channels/tui/frontend/src/ui/components/team-panel.ts；jiuwenswarm/channels/tui/frontend/src/ui/app-screen.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/components/team-shared.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/team-status-pill.ts；jiuwenswarm/channels/tui/frontend/src/core/event-handlers.ts；jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts
  - jiuwenswarm/channels/web/frontend/src/features/teamConnectionPresentation.ts；jiuwenswarm/channels/web/frontend/src/App.tsx；jiuwenswarm/channels/web/frontend/src/features/teamLeaderIdentity.ts；jiuwenswarm/channels/web/frontend/src/stores/sessionStore.ts
  - jiuwenswarm/channels/web/frontend/src/components/teamArea/ProcessListCard.tsx；jiuwenswarm/channels/web/frontend/src/stores/teamTaskNormalize.ts；jiuwenswarm/channels/web/frontend/src/features/teamTaskProgressBaseline.ts
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- Leader 与成员围绕团队目标分工，并通过团队运行时交换任务和状态。团队协作引入共享会话、技能可见性和资源收尾边界。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/harness/team/team_manager.py:L1–L3365](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L1-L3365)；
  - [docs/zh/AgentTeam.md:L1–L536](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AgentTeam.md#L1-L536)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `sync_team_observability()`；`shutdown_team_observability()`；`TeamRailMountContext`；`TeamManager [has_stream_task, pop_stream_task, begin_request, end_request, has_inflight_request]`；`is_team_session_running(session_id)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。
  - 参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/harness/team/team_manager.py:L1–L3365](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L1-L3365)；
  - [docs/zh/AgentTeam.md:L1–L536](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AgentTeam.md#L1-L536)。

### 配置入口与生效条件

- 该源码入口的构造或调用参数包括 `session_id`、`request_ids`、`channel_id`、`request_id`、`reason`、`exclude_session_ids`、`stop_runner`；它们是调用参数，不自动等同于全仓持久配置键。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/agents/harness/team/team_manager.py:L1–L3365](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L1-L3365)；
  - [docs/zh/AgentTeam.md:L1–L536](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AgentTeam.md#L1-L536)。

### 设计取舍

- **设计推断**：Leader 与 Teammate 分工可以并行推进复杂任务，代价是团队消息、任务状态、共享技能和停止条件需要协调。成员已启动或已回复不等于团队目标完成；验收还要追踪汇合结果与资源清理。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/harness/team/team_manager.py:L1–L3365](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L1-L3365)；
  - [docs/zh/AgentTeam.md:L1–L536](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AgentTeam.md#L1-L536)。

### 数据流与关联功能

- Leader 与成员围绕团队目标分工，并通过团队运行时交换任务和状态。团队协作引入共享会话、技能可见性和资源收尾边界。 联调时结合[[feature-distributed-team]]（跨进程分布式 Team）、[[feature-human-team]]（人类团队成员与人工协作）、[[feature-swarm-skills]]（团队技能与能力复用）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/harness/team/team_manager.py:L1–L3365](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L1-L3365)；
  - [docs/zh/AgentTeam.md:L1–L536](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AgentTeam.md#L1-L536)。

### 怎样验证

- 创建包含两个 AI 成员的团队，追踪任务分发、成员结果与 Leader 汇总。检查取消、成员失败与会话恢复，并分别验证本地多会话和分布式单活会话的边界。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/harness/team/team_manager.py:L1–L3365](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/team_manager.py#L1-L3365)；
  - [docs/zh/AgentTeam.md:L1–L536](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AgentTeam.md#L1-L536)。
