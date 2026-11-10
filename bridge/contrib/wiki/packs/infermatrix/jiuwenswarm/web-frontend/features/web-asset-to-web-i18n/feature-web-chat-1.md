---
name: feature-web-chat-1
description: Web 对话与流式状态功能概览（上）：本页基线说明、职责与边界、接口与调用入口（applyToolUpdatePayload 等五个符号）、配置入口与生效条件
metadata:
  scope: 只收页首说明与职责、API、配置三节；设计取舍、数据流关联与验证步骤归 feature-web-chat-2；实现细节归 feature-depth-web-chat
---
# Web 对话与流式状态 的职责、接口与配置（1/2）

## 关键事实

- 拆分说明：本页是源页 `feature-web-chat.md` 的第 1/2 部分；第 2 部分 [[feature-web-chat-2]]
- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-web-chat.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/对话.md
- 源页字段（feature）：web-chat
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts；jiuwenswarm/channels/web/frontend/src/*；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/index.tsx；jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py；jiuwenswarm/gateway/channel_manager/base.py
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/BeamSearchTree.css；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/BeamSearchTree.tsx；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ChatPanel.css
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MediaRenderer.tsx；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageItem.tsx；jiuwenswarm/common/chat_final.py；jiuwenswarm/channels/web/frontend/src/utils/chatFinalProtocol.ts
  - jiuwenswarm/channels/web/frontend/src/utils/finalContent.ts；jiuwenswarm/channels/web/frontend/src/types/message.ts；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/chatTimelineClock.ts；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageList.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/clipboardImagePaste.ts；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InputArea.tsx；jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/DiagramViewer.tsx
  - jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/diagramExport.ts；jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/useDiagramExportActions.ts
  - jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/codeBlocks/fencedCode.ts；jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/codeBlocks/registry.tsx；jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/codeBlocks/types.ts
  - jiuwenswarm/gateway/message_handler/command_parser/slash_command.py；jiuwenswarm/gateway/message_handler/message_handler.py；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/imeComposition.ts
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InlineQuestionCard.tsx；jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/index.tsx；jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/promptRouting.ts
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/katex.tsx；jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/index.ts；jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/markdownTransforms.ts
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/render.tsx；jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/MarkdownRenderer.tsx；jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/markdownPlugins.ts
  - jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/MermaidDiagram.tsx；jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/mermaidLayout.ts
  - jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/mermaidRuntime.ts；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/PickerPanel.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/PickerSearchInput.tsx；jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/QaSummaryCard.tsx；jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/qaSummary.ts
  - jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/math/remarkLatexDelimiters.ts；jiuwenswarm/channels/web/frontend/src/hooks/useResponsive.ts；jiuwenswarm/channels/web/frontend/src/utils/enabledExtensions.ts
  - jiuwenswarm/channels/web/frontend/src/services/sessionEventGate.ts；jiuwenswarm/server/agent_ws_server.py；jiuwenswarm/channels/web/frontend/src/features/sessionOutput.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/highlight.ts
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/SkillTreePath.tsx；jiuwenswarm/channels/web/frontend/src/types/skillTree.ts；jiuwenswarm/gateway/channel_manager/web/ws_connection_adapter.py；jiuwenswarm/channels/web/frontend/src/services/streamDeltaBatcher.ts
  - jiuwenswarm/channels/web/frontend/src/utils/svgDimensions.ts；jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/SvgDiagram.tsx；jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/diagrams/svgPreview.ts
  - jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/isolatedPreview.ts；jiuwenswarm/channels/web/frontend/src/utils/symphonyCommandDisplay.ts；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/TeamEventGroupDisplay.tsx
  - jiuwenswarm/channels/web/frontend/src/components/teamArea/ExpandedPanel.tsx；jiuwenswarm/channels/web/frontend/src/components/teamArea/ExpandedPanelTabs.tsx；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/timelineRowState.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/useProcessTreeCollapse.ts；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ToolCallDisplay.tsx；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ToolGroupDisplay.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/unsentImageDiscard.ts；jiuwenswarm/channels/web/frontend/src/utils/documentMessage.ts；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/VirtualTimeline.tsx
  - jiuwenswarm/channels/web/frontend/src/stores/sessionStore.ts；jiuwenswarm/gateway/channel_manager/web/web_connect.py；jiuwenswarm/gateway/channel_manager/web/web_channel_app.py；jiuwenswarm/channels/web/frontend/src/stores/chatStore.ts
  - jiuwenswarm/channels/web/frontend/src/utils/writeClipboard.ts；jiuwenswarm/channels/web/frontend/src/features/contextUsage/contextUsageCategories.ts；jiuwenswarm/channels/web/frontend/src/features/contextUsage/contextUsageModel.ts
  - jiuwenswarm/channels/web/frontend/tailwind.config.js；jiuwenswarm/channels/web/app_web.py；jiuwenswarm/channels/web/frontend/src/features/chatTimeline/buildTurnTimeline.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/MarkdownText.tsx
  - jiuwenswarm/channels/web/file_picker.py；jiuwenswarm/channels/web/frontend/src/stores/pendingQuestionQueue.ts；jiuwenswarm/channels/web/frontend/src/App.tsx；jiuwenswarm/channels/web/frontend/src/features/trajectory/SingleAgentSurface.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/slashCommands/semantics.ts；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/slashCommands/registry.ts；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/teamEventUtils.ts
  - jiuwenswarm/channels/web/frontend/src/features/teamLeaderMessages.ts；jiuwenswarm/channels/web/frontend/src/features/chatTimeline/projectTimelineItems.ts；jiuwenswarm/channels/web/frontend/src/utils/timestamp.ts
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/toolCategory.ts；jiuwenswarm/channels/web/frontend/src/features/tool-events/toolEventNormalizer.ts；jiuwenswarm/channels/web/frontend/src/stores/toolResultLifecycle.ts
  - jiuwenswarm/channels/web/frontend/src/features/tool-events/reviewerMetadata.ts；jiuwenswarm/channels/web/frontend/src/features/chatTimeline/index.ts；jiuwenswarm/channels/web/frontend/src/utils/userId.ts
  - jiuwenswarm/channels/web/frontend/src/features/UserQuestionModal/index.tsx；jiuwenswarm/channels/web/frontend/src/utils/uuid.ts；jiuwenswarm/channels/web/frontend/src/services/webClient.ts；jiuwenswarm/channels/browser/frontend/src/webview/chat.html
  - jiuwenswarm/server/runtime/gateway_adapter/workspace_file_adapter.py；jiuwenswarm/gateway/routing/base_ws_channel.py；jiuwenswarm/channels/web/frontend/src/utils/wsEventDedup.ts；jiuwenswarm/channels/web/frontend/src/types/websocket.ts
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- Web 客户端管理消息输入、流式展示与运行状态，后端负责真正的会话执行。界面显示的状态需要和服务端事件、会话标识一起解释。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/对话.md:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AF%B9%E8%AF%9D.md#L1-L312)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `applyToolUpdatePayload`；`streamDeltaBatchKey`；`ensureCrossSessionUserTurn`；`isCompletedResumeResult`；`scheduleAfterTurnSettles`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/对话.md:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AF%B9%E8%AF%9D.md#L1-L312)。

### 配置入口与生效条件

- 配置与启用条件的权威入口是下列功能文档和实现的调用方。本页提供查证路由：先确认当前宿主、会话或运行模式，再检查文档中的操作条件与实现消费的输入；不把 UI 文案、文件名或方法名猜作可写配置键。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/对话.md:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AF%B9%E8%AF%9D.md#L1-L312)。
