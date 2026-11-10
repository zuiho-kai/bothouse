---
name: components-chatpanel-contracts-02
description: components-chatpanel 源码接口与集成边界 02：web/frontend/src/components/ChatPanel 下 PermissionWarningDialog.tsx、PickerPanel.tsx、PickerSearchInput.tsx、ProactiveRecommendationCard.tsx、SkillPickerPanel.tsx、SkillTreePath.tsx、StreamingContent.tsx、TeamEventGroupDisplay.tsx、ToolCallDisplay.tsx、ToolGroupDisplay.tsx、VirtualTimeline.tsx、beamSearchTreeModel.ts、chatTimelineClock.ts、imeComposition.ts 共 14 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 14 个前端文件的静态声明，不证明运行行为；其余前端文件的声明归 components-chatpanel-contracts-01、components-chatpanel-contracts-03；入口说明归 components-chatpanel-overview
---
# components-chatpanel 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/PermissionWarningDialog.tsx`**
- 源码声明的类型、组件或调用边界：`PermissionWarningDialogProps`, `PermissionWarningDialog`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/PermissionWarningDialog.tsx#L1-L74)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/PickerPanel.tsx`**
- 源码声明的类型、组件或调用边界：`DEFAULT_MAX_VISIBLE_ROWS`, `DEFAULT_ROW_GAP`, `VIEWPORT_BOTTOM_GAP`, `VIEWPORT_TOP_GAP`, `listContentHeight`, `PickerPanelProps`, `PickerPanel`, `contentHeight`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import type { CSSProperties, MouseEventHandler, MutableRefObject, ReactNode, RefObject } from 'react`；`import clsx from 'clsx';`；`import MoreIcon from '../../assets/agent-management/more.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/PickerPanel.tsx#L1-L181)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/PickerSearchInput.tsx`**
- 源码声明的类型、组件或调用边界：`PickerSearchInputProps`, `PickerSearchInput`, `showClear`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import SearchIcon from '../../assets/agent-management/agent-search.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/PickerSearchInput.tsx#L1-L47)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ProactiveRecommendationCard.tsx`**
- 源码声明的类型、组件或调用边界：`ProactiveRecommendationCardProps`, `FEEDBACK_LS_PREFIX`, `loadFeedbackGiven`, `v`, `saveFeedbackGiven`, `typeConfig`, `ProactiveRecommendationCard`, `proactiveType`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import React, { useState, useCallback } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Sparkles, Clock, Compass, ThumbsUp, ThumbsDown } from 'lucide-react';`；`import ReactMarkdown from 'react-markdown';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ProactiveRecommendationCard.tsx#L1-L172)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/SkillPickerPanel.tsx`**
- 源码声明的类型、组件或调用边界：`RefObject`, `SkillItem`, `SkillType`, `InstalledPlugin`, `LIST_ROW_HEIGHT`, `SkillPickerPanelProps`, `SkillPickerPanel`, `activeSessionId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import clsx from 'clsx';`；`import { useChatStore, useSessionStore } from '../../stores';`；`import { webRequest } from '../../services/webClient';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/SkillPickerPanel.tsx#L1-L265)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/SkillTreePath.tsx`**
- 源码声明的类型、组件或调用边界：`SkillTreePathProps`, `BrowseNodeKind`, `BrowseNode`, `BrowseGraph`, `MAX_VISIBLE_CHILDREN`, `collectTrees`, `result`, `normalizeId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useMemo, useRef, useState } from 'react';`；`import clsx from 'clsx';`；`import type {`；`import './SkillTreePath.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/SkillTreePath.tsx#L1-L569)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/StreamingContent.tsx`**
- 源码声明的类型、组件或调用边界：`StreamingContentProps`, `StreamingContent`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/StreamingContent.tsx#L1-L11)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/TeamEventGroupDisplay.tsx`**
- 源码声明的类型、组件或调用边界：`TodoItem`, `ParsedTeamEvent`, `ActivityStatus`, `Translate`, `AgentTeamActivityCardProps`, `TeamMemberLike`, `MemberActivity`, `ActivityCandidate`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { ListChecks, MessageSquareText, Wrench } from 'lucide-react';`；`import { Message, type TodoItem } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/TeamEventGroupDisplay.tsx#L1-L589)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ToolCallDisplay.tsx`**
- 源码声明的类型、组件或调用边界：`ToolCallDisplayProps`, `DisclosureChevron`, `ToolCallDisplay`, `isSession`, `displayTitle`, `callGoal`, `displaySubtitle`, `isSymphonyCommand`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { ToolCall, ToolResult } from '../../types';`；`import { formatToolArguments, formatToolResult } from '../../utils';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ToolCallDisplay.tsx#L1-L170)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ToolGroupDisplay.tsx`**
- 源码声明的类型、组件或调用边界：`ToolCategory`, `TeamLeaderIdentity`, `ToolGroupDisplayProps`, `ToolStatusTone`, `TOOL_FLOWCHART_CANVAS_MIN_HEIGHT`, `ToolStatusIcon`, `isToolResultSuccessful`, `isToolExecutionFailed`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback } from 'react';`；`import { useTimelineRowState } from './timelineRowState';`；`import { useTranslation } from 'react-i18next';`；`import clsx from 'clsx';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ToolGroupDisplay.tsx#L1-L553)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/VirtualTimeline.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `VirtualItem`, `ROW_GAP`, `ESTIMATED_ROW_HEIGHT`, `TimelineViewportState`, `VirtualTimelineProps`, `VirtualTimeline`, `containerRef`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';`；`import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';`；`import type { TimelineDisplayItem } from '../../features/chatTimeline/projectTimelineItems';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/VirtualTimeline.tsx#L1-L150)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/beamSearchTreeModel.ts`**
- 源码声明的类型、组件或调用边界：`BeamTreeNodeEntry`, `BeamTreeMergeEntry`, `BeamTreeEntry`, `BeamTreeModel`, `compareNodes`, `compareEdges`, `leftNode`, `rightNode`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/beamSearchTreeModel.ts#L1-L114)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/chatTimelineClock.ts`**
- 源码声明的类型、组件或调用边界：`formatDurationPrecise`, `clamped`, `totalSeconds`, `totalMinutes`, `seconds`, `hours`, `minutes`, `useNow`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/chatTimelineClock.ts#L1-L34)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/imeComposition.ts`**
- 源码声明的类型、组件或调用边界：`ImeKeyboardEvent`, `isImeCompositionKey`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/imeComposition.ts#L1-L13)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-chatpanel/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
