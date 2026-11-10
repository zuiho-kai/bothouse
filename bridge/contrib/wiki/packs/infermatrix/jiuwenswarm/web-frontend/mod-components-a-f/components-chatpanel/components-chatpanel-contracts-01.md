---
name: components-chatpanel-contracts-01
description: components-chatpanel 源码接口与集成边界 01：web/frontend/src/components/ChatPanel 下 AutoReviewerStatus.tsx、BeamSearchTree.tsx、ChatModelSelector.tsx、ContextUsageIndicator.tsx、ExtensionPickerPanel.tsx、FileDownloadMediaPreviewContext.ts、HarnessProgressBar.tsx、InlineQuestionCard.tsx、InputArea.tsx、MediaRenderer.tsx、MessageItem.tsx、MessageList.tsx 共 12 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 12 个前端文件的静态声明，不证明运行行为；其余前端文件的声明归 components-chatpanel-contracts-02、components-chatpanel-contracts-03；入口说明归 components-chatpanel-overview
---
# components-chatpanel 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/AutoReviewerStatus.tsx`**
- 源码声明的类型、组件或调用边界：`AutoReviewerBadgeTone`, `BADGE_TONE_CLASS`, `MANUAL_DECISION_SOURCES`, `FAILURE_STATUSES`, `MANUAL_ACTION_STATUSES`, `RISK_LEVELS`, `ReviewerDecisionSourceCategory`, `reviewerDecisionSourceCategory`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import clsx from 'clsx';`；`import { useTranslation } from 'react-i18next';`；`import type { AutoReviewerMetadata, AutoReviewerStatus } from '../../types';`；`import { effectiveReviewerStatus, normalizeReviewerStatus } from '../../features/tool-events/reviewe`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/AutoReviewerStatus.tsx#L1-L157)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/BeamSearchTree.tsx`**
- 源码声明的类型、组件或调用边界：`BeamTreeMergeEntry`, `BeamTreeNodeEntry`, `MAX_VISIBLE_REJECTED_CHILDREN`, `BeamTreeCopy`, `COPY`, `BeamMergeReference`, `label`, `BeamTreeNodeCard`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo } from 'react';`；`import { useTimelineRowState } from './timelineRowState';`；`import clsx from 'clsx';`；`import { ChevronDown, GitMerge } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/BeamSearchTree.tsx#L1-L232)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ChatModelSelector.tsx`**
- 源码声明的类型、组件或调用边界：`openModelSettings`, `ChatModelSelector`, `models`, `activeSessionId`, `selectedModelName`, `defaultModelName`, `setSelectedModelName`, `selected`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { requestSettingsModule } from '../../features/settings/settingsNavigation';`；`import { useChatStore } from '../../stores/chatStore';`；`import { resolveChatModelSelection, useSessionStore } from '../../stores/sessionStore';`；`import ModelPicker from '../ModelPicker';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ChatModelSelector.tsx#L1-L33)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx`**
- 源码声明的类型、组件或调用边界：`CSSProperties`, `VIEWPORT_GAP`, `TOOLTIP_GAP`, `TOOLTIP_ALIGN_OFFSET`, `DETAIL_GAP`, `useElementWidth`, `element`, `updateWidth`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObje`；`import { createPortal } from 'react-dom';`；`import { X } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L1-L318)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ExtensionPickerPanel.tsx`**
- 源码声明的类型、组件或调用边界：`RefObject`, `LIST_ROW_HEIGHT`, `ExtensionPickerPanelProps`, `ExtensionPickerPanel`, `activeSessionId`, `enabledPlugins`, `enabledMcps`, `packages`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Loader2 } from 'lucide-react';`；`import { useChatStore, useSessionStore } from '../../stores';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ExtensionPickerPanel.tsx#L1-L458)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/FileDownloadMediaPreviewContext.ts`**
- 源码声明的类型、组件或调用边界：`FileDownloadMediaPreviewContext`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createContext } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/FileDownloadMediaPreviewContext.ts#L1-L4)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/HarnessProgressBar.tsx`**
- 源码声明的类型、组件或调用边界：`StageStatusIconProps`, `StageStatusIcon`, `StageItemProps`, `StageItem`, `visibleMessages`, `normalized`, `hasDetails`, `ExtensionStatusIcon`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import React, { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { useHarnessStore, useSessionStore, useChatStore } from '../../stores';`；`import type { ExtensionProgressInfo, ExtensionProgressStatus } from '../../stores/harnessStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/HarnessProgressBar.tsx#L1-L431)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InlineQuestionCard.tsx`**
- 源码声明的类型、组件或调用边界：`InlineQuestionCardProps`, `OTHER_VALUE`, `isOtherOption`, `ApprovalQuestionContent`, `PlanApprovalActions`, `hasRevision`, `InlineQuestionCard`, `activeSessionId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState, useCallback, useMemo, useEffect } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { useChatStore } from '../../stores';`；`import { UserAnswer, QuestionOption, Question } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InlineQuestionCard.tsx#L1-L587)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InputArea.tsx`**
- 源码声明的类型、组件或调用边界：`CSSProperties`, `RefObject`, `SVGProps`, `ProjectInfo`, `ProjectCreateMode`, `GoalSlashAction`, `GoalSlashSnapshot`, `SlashCommand`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`；`import type { TFunction } from 'i18next';`；`import { AtSign, ChevronRight, CircleX, Loader2, Lock, Mic, Plus, Settings, Square, Workflow, X } fr`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InputArea.tsx#L1-L5372)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MediaRenderer.tsx`**
- 源码声明的类型、组件或调用边界：`MediaRendererProps`, `VISIBLE_FILE_COUNT`, `isImageItem`, `isCardItem`, `mediaSrc`, `mimeType`, `base64Data`, `FileCard`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useRef, useState } from 'react';`；`import { MediaItem } from '../../types';`；`import { FileIcon, getFileExtensionLabel } from '../FileIcon';`；`import { stripUploadDocumentBlocks } from '../../utils/documentMessage';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MediaRenderer.tsx#L1-L239)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageItem.tsx`**
- 源码声明的类型、组件或调用边界：`DesktopSaveApiResult`, `TeamLeaderIdentity`, `openArtifactPanelForActiveMode`, `sessionId`, `mode`, `MarkdownMessageBody`, `CompactCommandDivider`, `TeamMemberMessageFrame`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState, useCallback, useContext, useEffect, useRef, useMemo, memo } from 'react';`；`import type { ReactNode } from 'react';`；`import {`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageItem.tsx#L1-L1280)。
- **`jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageList.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `TimelineDisplayItem`, `TimelineViewportState`, `LiveWorkStreak`, `EMPTY_EXPANSIONS`, `EMPTY_REASONING`, `MessageListProps`, `ChatTimelineListProps`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';`；`import clsx from 'clsx';`；`import { LoaderCircle } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageList.tsx#L1-L944)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-chatpanel/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
