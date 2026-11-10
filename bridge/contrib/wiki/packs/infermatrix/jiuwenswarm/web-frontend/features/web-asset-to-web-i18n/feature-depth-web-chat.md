---
name: feature-depth-web-chat
description: Web 对话与流式状态实现深读：request 薄封装与 team.snapshot 调用义务、goal get 连续失败收敛为 unknown、sendQueuedTaskInput 仅 agent 模式派发、resolveInterruptResumeMode 的 team_name 优先、chat.processing_status 丢弃条件、Markdown 预处理取舍、前端构建与 A2UI 默认值脚本
metadata:
  scope: 只收 useWebSocket 与会话 store 回调的六个 facet 深读；职责边界、符号入口与验收建议归 feature-web-chat-1、feature-web-chat-2
---
# Web 对话与流式状态：实现深读

## 现状

- [[feature-web-chat-1]]、[[feature-web-chat-2]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **request 的薄封装契约** useWebSocket 返回的 request<T>(method, params, options) 只是 webClient.request 的透传封装（回调内一行委托），调用方按统一 WS 请求帧使用 method（如 team.snapshot）加 params.session_id；reconcileTeamMembersFromSnapshot 展示了调用者义务：传入 timeoutMs: 5000 并自行捕获异常，失败时静默保留旧状态。
- 来源：[jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1250–L1259](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1250-L1259),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1261–L1276](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1261-L1276)
- **goal get 连续失败收敛为 unknown** performGoalGet 中 requestGoalAction 抛错且重试次数耗尽（attempt >= GOAL_GET_RETRY_DELAYS_MS.length）时，不抛出异常，而是把 queryStatus 置 'unknown' 并清空 pendingAction 后返回；成功路径由 applyIncomingGoal 把 queryStatus 收敛回 'ok'。
- 来源：[jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L434–L448](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L434-L448),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L291–L296](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L291-L296)
- **前端构建与 A2UI 默认值脚本** 文档给出的前端相关验证入口：`npm run build`（Web renderer 构建）与 `node scripts/test-a2ui-action-defaults.mjs`（校验 A2UI choice 默认值补齐），后端配套 `uv run pytest tests/unit_tests/a2ui tests/system_tests/test_a2ui_system_flow.py`。这些是文档记录的测试命令，本页未声明其在当前基线已通过。
- 来源：[docs/zh/A2UI.md:L72–L87](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2UI.md#L72-L87)
- **sendQueuedTaskInput：仅 agent 模式派发排队输入并预置处理态** 回调先读 useSessionStore 的 runtime mode，非 'agent' 即本地返回；claimTaskInput 认领不到该任务也返回；发起时若 isProcessing 为假，则 setProcessing(true) 并 setThinking(true)，随后取 activeExecutionId 经注入的 request 发出 'chat.send'。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/sessionInput.ts:L25–L43](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/sessionInput.ts#L25-L43)
- **resolveInterruptResumeMode：非空 team_name 优先于 runtime mode** 先定位会话：sessionId 匹配 currentSession，否则在 sessions 列表查找；team_name 去空白后非空直接返回 'team'，否则返回 normalizeAgentMode(runtimes[sessionId]?.mode)。效果：带团队名的会话中断恢复模式解析为 team，覆盖存储的 runtime mode。
- 来源：[jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L515–L523](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L515-L523)
- **chat.processing_status 回调依赖 chatStore 的 switchingMode/isLoadingHistory** 回调先经 shouldDropDuplicatedEvent 去重并跳过主动推荐 payload，再依赖 useChatStore.getRuntime(sessionId) 的 switchingMode 与 isLoadingHistory 标志：任一为真即丢弃本次更新；后果是切模式或加载历史期间会话处理状态不更新。
- 来源：[jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L4343–L4352](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L4343-L4352)
- **Markdown 预处理按 [content]/[markdown] 依赖复用；依赖不变时免重算，内容变化仍整段重算（推断）** 设计推断（非作者历史意图）：
- 助手流式与最终气泡均经 A2UIMessageContent，text part 用 MarkdownRenderer；其 useMemo 以 [content] 做 unescapeLiteralNewlines+repairCollapsedGfmTables，以 [markdown] 分行。推断收益：依赖不变的重渲染复用旧结果；代价：内容一变（如流式追加）仍对整段字符串重新预处理。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageItem.tsx:L812–L837](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageItem.tsx#L812-L837),
  - [jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx:L159–L168](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx#L159-L168),
  - [jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/MarkdownRenderer.tsx:L97–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/MarkdownRenderer.tsx#L97-L99)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-web-chat.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1250-L1259；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1261-L1276
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2UI.md:L72-L87；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L434-L448
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L291-L296；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/sessionInput.ts:L25-L43
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L515-L523；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L4343-L4352
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageItem.tsx:L812-L837
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx:L159-L168
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/MarkdownRenderer.tsx:L97-L99
- 源页字段（feature）：web-chat
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts；jiuwenswarm/channels/web/frontend/src/*
