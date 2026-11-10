---
name: feature-projects-sessions-1
description: 项目、会话与历史管理功能入口（上）：基线 f0a69728c96b、项目工作区与会话记录的数据边界、session_catalog.py 的 SessionCatalogError/SessionGetInput/SessionListInput 等声明入口、构造参数与配置生效条件
metadata:
  scope: 只收职责与边界、接口与调用入口、配置入口与生效条件三节；设计取舍、关联功能与验证步骤归 feature-projects-sessions-2，实现级证据归 feature-depth-projects-sessions
---
# 项目、会话与历史管理 的职责、接口与配置（1/2）

## 关键事实

- 拆分说明：本页是源页 `feature-projects-sessions.md` 的第 1/2 部分；第 2 部分 [[feature-projects-sessions-2]]
- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/feature-projects-sessions.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_catalog.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_lifecycle.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/项目与会话管理.md
- 源页字段（feature）：projects-sessions
- 入口（entry_points）：jiuwenswarm/runtime/session_catalog.py；jiuwenswarm/runtime/session_lifecycle.py
- 源页字段（source_globs）：jiuwenswarm/runtime/session_catalog.py；jiuwenswarm/runtime/session_lifecycle.py；jiuwenswarm/runtime/session*.py；jiuwenswarm/server/utils/diff_service.py；jiuwenswarm/server/runtime/session/session_archive.py
  - jiuwenswarm/channels/web/frontend/src/features/workspace/archivedTaskGrouping.ts；jiuwenswarm/channels/web/frontend/src/features/settings/modules/archivedTasks/useArchivedTaskLists.ts；jiuwenswarm/common/cleanup.py
  - jiuwenswarm/channels/browser/frontend/src/background/SessionManager.ts；jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts；jiuwenswarm/channels/browser/frontend/src/sidepanel/sidepanel.html；jiuwenswarm/server/agent_ws_server.py
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InputArea.tsx；jiuwenswarm/server/runtime/agent_adapter/interface.py；jiuwenswarm/channels/web/frontend/src/multi-session/state/createConversationSession.ts
  - jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/ConversationSidebar.css；jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/ConversationSidebar.tsx；jiuwenswarm/server/runtime/agent_adapter/session_message_input.py
  - jiuwenswarm/server/control/history_service.py；jiuwenswarm/server/control/health_service.py；jiuwenswarm/server/control/methods.py；jiuwenswarm/server/control/responses.py；jiuwenswarm/server/control/project_service.py
  - jiuwenswarm/server/control/repositories/project_repository.py；jiuwenswarm/server/control/repositories/session_repository.py；jiuwenswarm/server/control/session_service.py；jiuwenswarm/channels/web/frontend/src/features/code-mode/gitClient.ts；jiuwenswarm/gateway/app_gateway.py
  - jiuwenswarm/common/utils.py；jiuwenswarm/common/git_safe_directory.py；jiuwenswarm/server/runtime/session/session_history.py；jiuwenswarm/channels/web/frontend/src/components/AgentPanel/FileViewer.tsx；jiuwenswarm/channels/web/frontend/src/features/historyRestore.ts
  - jiuwenswarm/server/runtime/session/history_io.py；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageList.tsx；jiuwenswarm/server/front/router.py；jiuwenswarm/server/wire_truncate.py；jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts
  - jiuwenswarm/gateway/im_pipeline/im_session_input.py；jiuwenswarm/server/runtime/session/session_metadata.py；jiuwenswarm/agents/harness/common/session_ops_service.py；jiuwenswarm/channels/web/frontend/src/multi-session/state/newConversationLifecycle.ts
  - jiuwenswarm/channels/web/frontend/src/multi-session/state/newConversationPreviousSession.ts；jiuwenswarm/channels/web/frontend/src/multi-session/state/newConversationProject.ts；jiuwenswarm/server/runtime/offline_session_cleanup.py
  - jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/channels/process_cli/app.py；jiuwenswarm/channels/web/frontend/src/features/workspace/projectDirectoryPicker.ts
  - jiuwenswarm/server/runtime/gateway_adapter/project_adapter.py；jiuwenswarm/server/runtime/session/project_queries.py；jiuwenswarm/channels/web/frontend/src/features/workspace/projectRegistryClient.ts；jiuwenswarm/channels/web/frontend/src/features/workspace/projectTypes.ts
  - jiuwenswarm/server/control/store/project_queries.py；jiuwenswarm/server/runtime/session/project_store.py；jiuwenswarm/common/projectless_workspace.py；jiuwenswarm/runtime/session_provisioner.py；jiuwenswarm/runtime/service.py；jiuwenswarm/runtime/request.py
  - jiuwenswarm/common/runtime_workspace.py；jiuwenswarm/server/runtime/agent_adapter/sensitive_answers.py；jiuwenswarm/channels/web/frontend/src/features/workspace/archivedTaskClient.ts；jiuwenswarm/runtime/session/coordinator.py；jiuwenswarm/runtime/session_delete.py
  - jiuwenswarm/runtime/session/model.py；jiuwenswarm/runtime/session/execution_registry.py；jiuwenswarm/server/runtime/session/git_diff_status.py；jiuwenswarm/server/runtime/gateway_adapter/session_adapter.py；jiuwenswarm/channels/web/frontend/src/components/SessionsPanel/index.tsx
  - jiuwenswarm/server/runtime/session/session_info.py；jiuwenswarm/server/runtime/session/lifecycle.py；jiuwenswarm/gateway/routing/session_map.py；jiuwenswarm/server/runtime/session/model_selection_store.py；jiuwenswarm/server/runtime/session/session_rename.py
  - jiuwenswarm/server/runtime/agent_manager.py；jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/ProjectArchiveDialog.tsx；jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/projectArchiveModel.ts
  - jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/useSidebarMenu.tsx；jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/ProjectCreateMenu.tsx；jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/projectCreateErrors.ts
  - jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/SidebarActionMenu.tsx；jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/SidebarMenu.tsx；jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/sidebarMenuSchema.ts
  - jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/sidebarModel.ts；jiuwenswarm/server/runtime/agent_adapter/team_helpers.py；jiuwenswarm/agents/harness/team/team_manager.py；jiuwenswarm/channels/tui/frontend/src/app-state.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/new.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/rename.ts；jiuwenswarm/channels/tui/frontend/src/ui/app-screen.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/resume.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/rewind.ts；jiuwenswarm/gateway/channel_manager/tui/tui_connect.py；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/sessions.ts
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/archivedTasks/ArchivedTasksSettings.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/archivedTasks/definition.ts；jiuwenswarm/channels/web/frontend/src/features/historyPagination.ts
  - jiuwenswarm/channels/web/frontend/src/App.tsx；jiuwenswarm/channels/web/frontend/src/features/historyRecordReassembler.ts；jiuwenswarm/gateway/channel_manager/web/lifecycle_handlers.py；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/index.tsx
  - jiuwenswarm/channels/web/frontend/src/multi-session/dialogs/Dialogs.tsx；jiuwenswarm/channels/web/frontend/src/multi-session/dialogs/dialogs.css；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/projectSelection.ts；jiuwenswarm/channels/web/frontend/src/types/index.ts
  - jiuwenswarm/channels/web/frontend/src/features/teamHistoryPanelRestore.ts；jiuwenswarm/channels/web/frontend/src/stores/workspaceStore.ts；jiuwenswarm/channels/browser/frontend/src/webview/chat.html；jiuwenswarm/channels/web/frontend/src/features/workspace/workModeStorage.ts
  - jiuwenswarm/common/work_mode.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 项目工作区与会话记录构成不同的数据边界。新建、恢复、切换和删除会话需要沿 Runtime 协调器确认对历史、执行和宿主状态的影响。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/runtime/session_catalog.py:L1–L292](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L1-L292)；
  - [jiuwenswarm/runtime/session_lifecycle.py:L1–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_lifecycle.py#L1-L181)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `SessionCatalogError`；`SessionGetInput`；`SessionListInput`；`SessionSummary [to_dict]`；`SessionListResult [to_dict]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/runtime/session_catalog.py:L1–L292](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L1-L292)；
  - [jiuwenswarm/runtime/session_lifecycle.py:L1–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_lifecycle.py#L1-L181)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)。

### 配置入口与生效条件

- 该源码入口的构造或调用参数包括 `message`、`code`、`request`；它们是调用参数，不自动等同于全仓持久配置键。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/runtime/session_catalog.py:L1–L292](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L1-L292)；
  - [jiuwenswarm/runtime/session_lifecycle.py:L1–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_lifecycle.py#L1-L181)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)。
