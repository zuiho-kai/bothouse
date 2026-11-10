---
name: components-chatpanel-contracts-03
description: components-chatpanel 源码接口与集成边界 03：web/frontend/src/components 下 ChatPanel/clipboardImagePaste.ts、ChatPanel/evolution-status.ts、ChatPanel/index.tsx、ChatPanel/projectSelection.ts、ChatPanel/slashCommands/registry.ts、ChatPanel/slashCommands/semantics.ts、ChatPanel/teamEventUtils.ts、ChatPanel/timelineRowState.tsx、ChatPanel/toolCategory.ts、ChatPanel/unsentImageDiscard.ts、ChatPanel/useProcessTreeCollapse.ts 共 11 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 11 个前端文件的静态声明，不证明运行行为；其余前端文件的声明归 components-chatpanel-contracts-01、components-chatpanel-contracts-02；入口说明归 components-chatpanel-overview
---
# components-chatpanel 源码接口与集成边界 03

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/clipboardImagePaste.ts`**
- 源码声明的类型、组件或调用边界：`ACCEPTED_IMAGE_TYPES`, `IMAGE_EXTENSIONS`, `IMAGE_INPUT_DISABLED_ALERT_KEY`, `ImageInputDisabledState`, `isImageInputDisabled`, `shouldAlertImagePasteDisabled`, `getFileExtension`, `idx`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/clipboardImagePaste.ts#L1-L158)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/evolution-status.ts`**
- 源码声明的类型、组件或调用边界：`Translate`, `STAGE_KEY_MAP`, `getEvolutionPillLabel`, `stage`, `translationKey`, `message`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AgentMode } from '../../types/index.ts';`；`import type { EvolutionStatusPayload } from '../../types/websocket.ts';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/evolution-status.ts#L1-L46)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/index.tsx`**
- 源码声明的类型、组件或调用边界：`ChatSendOptions`, `MessageForkPoint`, `Permission`, `ProjectInfo`, `InputAreaHandle`, `TeamMemberIdentity`, `DesktopLocalFilesEventDetail`, `LocalFilePick`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import React, { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import {`；`import type { TFunction } from 'i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/index.tsx#L1-L2138)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/projectSelection.ts`**
- 源码声明的类型、组件或调用边界：`isDefaultInputProject`, `getInputProjectOptions`, `keyword`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ProjectInfo } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/projectSelection.ts#L1-L14)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/slashCommands/registry.ts`**
- 源码声明的类型、组件或调用边界：`SlashCommandContext`, `SlashCommand`, `PlanSlashStore`, `GoalSlashStore`, `GoalPlanSlashStore`, `GoalSlashAction`, `GoalSlashSnapshot`, `GoalSlashIntent`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { webRequest } from '../../../services/webClient';`；`import type { Message } from '../../../types/message';`；`import { useGoalStore } from '../../../stores/goalStore';`；`import { usePlanStore } from '../../../stores/planStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/slashCommands/registry.ts#L1-L420)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/slashCommands/semantics.ts`**
- 源码声明的类型、组件或调用边界：`supportsWebSlashCommands`, `getWebSlashCommandsForMode`, `resolveSlashCommandDescription`, `locale`, `descriptions`, `GoalWithStatus`, `hasUnfinishedGoal`, `PlanGoalInterlockDecision`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/slashCommands/semantics.ts#L1-L56)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/teamEventUtils.ts`**
- 源码声明的类型、组件或调用边界：`ParsedTeamEvent`, `formatTeamEventTime`, `date`, `parseTeamEventMessage`, `jsonStr`, `payload`, `event`, `type`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Message } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/teamEventUtils.ts#L1-L78)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/timelineRowState.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `TimelineRowStateContext`, `TimelineRowStateProvider`, `context`, `useTimelineRowState`, `context`, `key`, `updateValue`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createContext, useCallback, useContext, useMemo, useState, type ReactNode, type SetStateAct`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/timelineRowState.tsx#L1-L37)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/toolCategory.ts`**
- 源码声明的类型、组件或调用边界：`ToolCategory`, `TOOL_CATEGORY_ORDER`, `ToolDisplayDefinition`, `normalize`, `TOOL_DISPLAY_REGISTRY`, `register`, `name`, `humanizeToolName`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/toolCategory.ts#L1-L183)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/unsentImageDiscard.ts`**
- 源码声明的类型、组件或调用边界：`UnsentImageDraft`, `UnsentImageDiscardPlan`, `planUnsentImageDiscard`, `keptPaths`, `draft`, `pendingIds`, `paths`, `seenPaths`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/unsentImageDiscard.ts#L1-L37)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/useProcessTreeCollapse.ts`**
- 源码声明的类型、组件或调用边界：`SetStateAction`, `useProcessTreeCollapse`, `setCollapsed`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, type SetStateAction } from 'react';`；`import { useTimelineRowState } from './timelineRowState';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/useProcessTreeCollapse.ts#L1-L23)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-chatpanel/source-contracts-03.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
