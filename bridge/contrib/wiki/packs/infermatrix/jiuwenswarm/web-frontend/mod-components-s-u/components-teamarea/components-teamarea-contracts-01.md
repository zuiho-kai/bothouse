---
name: components-teamarea-contracts-01
description: components-teamarea 源码接口 01：teamArea 目录下 AgentDetailModal、CompactTaskList、ExpandedPanel、ExpandedPanelTabs、MemberListItem、MemberOverviewCard、MemberTaskList、ProcessListCard、SwarmflowGraphView、SwarmflowTreeView、TaskPlanningPanel、TeamMembersPanel 十二个 tsx 文件的声明、导入依赖与源码行区间
metadata:
  scope: 只收这十二个文件的接口记录；UnassignedTeamAvatar、index、shared、taskProgress、workflowTypes 归 components-teamarea-contracts-02，目录入口归 components-teamarea-overview
---
# components-teamarea 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/AgentDetailModal.tsx`**
- 源码声明的类型、组件或调用边界：`formatCharCount`, `n`, `DetailSectionKey`, `DetailAccent`, `DetailSection`, `AgentModalState`, `accentTextClass`, `accentChipClass`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { MarkdownRenderer } from '../MarkdownRenderer';`；`import type { WorkflowAgent } from './workflowTypes';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/AgentDetailModal.tsx#L1-L379)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/CompactTaskList.tsx`**
- 源码声明的类型、组件或调用边界：`TaskColumnKey`, `compactStatusIcons`, `CompactTaskListProps`, `CompactTaskList`, `visibleTasks`, `assigneeExists`, `assigneeName`, `title`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { CircleAlert } from 'lucide-react';`；`import { ApplicationTaskControls } from '../../applicationPlugins/ApplicationTaskControls';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/CompactTaskList.tsx#L1-L154)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/ExpandedPanel.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `ExpandedPanelProps`, `ExpandedPanel`, `tabPanelId`, `artifactsCount`, `handleToggleFullscreen`, `resolvedTab`, `tabs`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useId, type ReactNode } from 'react';`；`import { useFullscreenPanel } from '../../hooks';`；`import { useSessionArtifactsCount } from '../ArtifactsPanel';`；`import { ArtifactExpandedPanel } from '../ArtifactsPanel';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/ExpandedPanel.tsx#L1-L121)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/ExpandedPanelTabs.tsx`**
- 源码声明的类型、组件或调用边界：`KeyboardEvent`, `PanelTabItem`, `useExpandedPanelTabs`, `ExpandedPanelTabs`, `tabPanelId`, `handleTabCloseKeyDown`, `isActive`, `countSuffix`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useId, type KeyboardEvent, type ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Globe2, Minimize2 } from 'lucide-react';`；`import MaximizeIcon from '../../assets/maximize.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/ExpandedPanelTabs.tsx#L1-L185)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/MemberListItem.tsx`**
- 源码声明的类型、组件或调用边界：`TeamMember`, `TaskProgress`, `MemberListItem`, `displayName`, `statusKey`, `progressPercent`, `radius`, `strokeWidth`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { TeamMemberAvatar } from '../TeamMemberAvatar';`；`import PendingIcon from '../../assets/pending.svg?react';`；`import { LoadingSpinner } from '../ui/LoadingSpinner/LoadingSpinner';`；`import { getMemberPlainName, getMemberStatusKey, type TeamMember } from './shared';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/MemberListItem.tsx#L1-L121)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/MemberOverviewCard.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `MemberOverviewCardProps`, `MemberOverviewCard`, `toggleItem`, `next`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState, type ReactNode } from 'react';`；`import { TeamMemberAvatar } from '../TeamMemberAvatar';`；`import { ProcessListCard } from './ProcessListCard';`；`import type { ProcessItem } from './shared';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/MemberOverviewCard.tsx#L1-L81)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/MemberTaskList.tsx`**
- 源码声明的类型、组件或调用边界：`MemberTask`, `MemberTaskListItem`, `MemberTaskListBar`, `completedCount`, `latestTask`, `aTime`, `bTime`, `MemberTaskListPanel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import React, { useRef } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { StatusIcon, type MemberTask, type TaskStatus } from './shared';`；`import { useAdaptiveTooltip } from '../../hooks/useAdaptiveTooltip';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/MemberTaskList.tsx#L1-L132)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/ProcessListCard.tsx`**
- 源码声明的类型、组件或调用边界：`ProcessDetailRow`, `Translate`, `getProcessMessageType`, `getExecutionKindLabel`, `buildProcessDetailRows`, `rows`, `ProcessListCard`, `expanded`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { MessageSquare, Wrench } from 'lucide-react';`；`import { Chevron, StatusIcon, getTaskStatusLabel, type ProcessDetailRow, type ProcessItem, type Task`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/ProcessListCard.tsx#L1-L190)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/SwarmflowGraphView.tsx`**
- 源码声明的类型、组件或调用边界：`Node`, `Edge`, `NodeProps`, `WorkflowRun`, `WorkflowPhase`, `WorkflowAgent`, `WorkflowStatus`, `WorkflowVerifyGroup`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useState } from 'react';`；`import {`；`import '@xyflow/react/dist/style.css';`；`import dagre from '@dagrejs/dagre';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/SwarmflowGraphView.tsx#L1-L922)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/SwarmflowTreeView.tsx`**
- 源码声明的类型、组件或调用边界：`ReactElement`, `WorkflowRun`, `WorkflowPhase`, `WorkflowAgent`, `WorkflowStatus`, `WorkflowVerifyGroup`, `AgentModalState`, `DetailSection`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';`；`import {`；`import { useTranslation } from 'react-i18next';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/SwarmflowTreeView.tsx#L1-L1686)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/TaskPlanningPanel.tsx`**
- 源码声明的类型、组件或调用边界：`TaskColumnKey`, `TeamMember`, `TaskPlanningPanelProps`, `COLUMN_STATS`, `ProgressBar`, `ProgressSection`, `emptyIllustrationSize`, `progressPercent`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo, useState } from 'react';`；`import type { ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { File, GitBranch, Maximize2, Puzzle } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/TaskPlanningPanel.tsx#L1-L701)。
- **`jiuwenswarm/channels/web/frontend/src/components/teamArea/TeamMembersPanel.tsx`**
- 源码声明的类型、组件或调用边界：`TeamConnectionPresentation`, `ParsedTeamEvent`, `TeamDetailTab`, `TeamMember`, `TeamMembersPanelProps`, `GroupMessageItem`, `getGroupMemberIds`, `isGroupMessageItem`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { memo, useEffect, useMemo, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { useChatStore, useSessionStore, useTodoStore } from '../../stores';`；`import type { Message, TeamMemberContextCompressionState } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/teamArea/TeamMembersPanel.tsx#L1-L752)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-teamarea/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
