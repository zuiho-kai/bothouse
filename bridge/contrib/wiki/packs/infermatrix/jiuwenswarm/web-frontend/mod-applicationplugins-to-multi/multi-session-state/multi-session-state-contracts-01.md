---
name: multi-session-state-contracts-01
description: multi-session-state 源码接口 01：multi-session/state 下 createConversationSession、newConversationLifecycle、newConversationPreviousSession、newConversationProject 四个文件的声明与导入依赖
metadata:
  scope: 只收这四个文件的接口记录；目录入口归 multi-session-state-overview
---
# multi-session-state 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/state/createConversationSession.ts`**
- 源码声明的类型、组件或调用边界：`SESSION_CREATE_TIMEOUT_MS`, `SESSION_CREATE_METADATA_POLL_ATTEMPTS`, `SESSION_CREATE_METADATA_POLL_INTERVAL_MS`, `SessionCreateRequestFn`, `SessionCreatePayload`, `CreatedConversationSession`, `CreateConversationSessionOptions`, `PersistSessionCommand`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { WorkMode } from '../../features/workspace/projectTypes';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/state/createConversationSession.ts#L1-L135)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/state/newConversationLifecycle.ts`**
- 源码声明的类型、组件或调用边界：`NEW_CONVERSATION_ID`, `ConversationRuntimeSettings`, `NewConversationEntrySettings`, `resolveNewConversationEntrySettings`, `locallyCreatedConversations`, `createConversationTitle`, `applyRuntimeSettings`, `resetNewConversationRuntime`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import type { AgentMode, Session } from '../../types';`；`import { toDisplaySessionTitle } from '../../utils/documentMessage';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/state/newConversationLifecycle.ts#L1-L131)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/state/newConversationPreviousSession.ts`**
- 源码声明的类型、组件或调用边界：`PendingPreviousSession`, `ResolvePendingPreviousSessionOptions`, `resolvePendingPreviousSession`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AgentMode } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/state/newConversationPreviousSession.ts#L1-L33)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/state/newConversationProject.ts`**
- 源码声明的类型、组件或调用边界：`resolveNewConversationProjectDir`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/state/newConversationProject.ts#L1-L8)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/multi-session-state/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
