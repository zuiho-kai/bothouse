---
name: features-trajectory-contracts-01
description: features-trajectory 源码接口 01：trajectory 下 SingleAgentSurface、TeamTrajectoryWorkspace、TrajectoryPanel、client（TrajectoryExplorer、TrajectoryTable、TrajectoryTimeline、TrajectoryToolbar、i18n）、featureConfig、index 与 primitives 的 JsonTree、Menu、Tooltip 的声明与导入依赖
metadata:
  scope: 只收 trajectory 的 SingleAgentSurface 至 primitives/Tooltip.tsx 各文件的接口记录；primitives/icons 与 markdown 归 features-trajectory-contracts-02
---
# features-trajectory 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/SingleAgentSurface.tsx`**
- 源码声明的类型、组件或调用边界：`ChatSurfaceView`, `SingleAgentSurfaceProps`, `SingleAgentSurface`, `trajectoryMode`, `navigationVisible`, `resolvedView`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/SingleAgentSurface.tsx#L1-L99)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/TeamTrajectoryWorkspace.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `TrajectoryKey`, `TeamMemberLaneModel`, `TeamMemberViewContext`, `TeamTrajectoryWorkspaceProps`, `MemberToolbarControl`, `TeamTrajectoryWorkspace`, `lanes`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import type { TrajectoryViewState } from './client/TrajectoryExplorer';`；
  - `import { trajectoryTranslator, type TrajectoryKey } from './client/i18n';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/TeamTrajectoryWorkspace.tsx#L1-L169)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/TrajectoryPanel.tsx`**
- 源码声明的类型、组件或调用边界：`ChangeEvent`, `KeyboardEvent`, `PointerEvent`, `TrajectoryRetentionCheckpoints`, `TrajectoryDetailRecord`, `TrajectorySubjectSummary`, `TrajectoryArchiveProgress`, `TrajectoryArchiveReplay`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { useTranslation } from 'react-i18next';`；`import { webClient } from '../../services/webClient';`；`import { saveBlobWithResult } from '../../utils/desktopSave';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/TrajectoryPanel.tsx#L1-L1771)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryExplorer.tsx`**
- 源码声明的类型、组件或调用边界：`CSSProperties`, `TrajectoryTimelineMode`, `TrajectoryTimeRange`, `TrajectoryColorMode`, `TrajectoryKey`, `EMPTY_TURN_IDS`, `EMPTY_RECORD_IDS`, `ExplorerStyle`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import type {`；`import { trajectoryRecordId } from '../trajectory/record.ts'`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryExplorer.tsx#L1-L365)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryTable.tsx`**
- 源码声明的类型、组件或调用边界：`BOTTOM_FOLLOW_THRESHOLD_PX`, `VIRTUALIZATION_THRESHOLD`, `VIRTUAL_OVERSCAN_ROWS`, `VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX`, `KIND_LABEL`, `ToolWrenchIcon`, `InformationIcon`, `CompactedIcon`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'`；`import type { CSSProperties, ReactNode } from 'react'`；`import { useVirtualizer } from '@tanstack/react-virtual'`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryTable.tsx#L1-L3342)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryTimeline.tsx`**
- 源码声明的类型、组件或调用边界：`CSSProperties`, `KeyboardEvent`, `TrajectoryTimelineMode`, `TrajectoryTimelineSegment`, `TrajectoryTimelineSpan`, `TrajectoryTimeRange`, `MINIMUM_DRAG_PX`, `MINIMUM_ZOOM_OPERATIONS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { Tooltip } from '../primitives/index.ts'`；`import type { TrajectoryTurnModel } from '../trajectory/model.ts'`；`import type { AssistantMetricDetail, TrajectoryCellKind, TrajectoryCellProps } from '../trajectory/r`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryTimeline.tsx#L1-L934)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryToolbar.tsx`**
- 源码声明的类型、组件或调用边界：`TrajectoryToolbarProps`, `TrajectoryToolbar`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react'`；`import { IconSearchOutline16 } from '../primitives/index.ts'`；`import type { TrajectoryTranslate } from './i18n.ts'`；`import css from './TrajectoryToolbar.module.css'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryToolbar.tsx#L1-L170)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/client/i18n.ts`**
- 源码声明的类型、组件或调用边界：`TrajectoryKey`, `TrajectoryTranslate`, `en`, `trajectoryTranslator`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/client/i18n.ts#L1-L47)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/featureConfig.ts`**
- 源码声明的类型、组件或调用边界：`trajectoryUiEnabled`, `listeners`, `normalizeTrajectoryUiEnabled`, `setTrajectoryUiEnabled`, `isTrajectoryUiEnabled`, `subscribe`, `useTrajectoryUiEnabled`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useSyncExternalStore } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/featureConfig.ts#L1-L36)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/index.ts`**
- 集成边界的导入/加载声明：`import './client/theme.css'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/index.ts#L1-L72)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/JsonTree.tsx`**
- 源码声明的类型、组件或调用边界：`OBJECT_PREVIEW_LIMIT`, `ARRAY_PREVIEW_LIMIT`, `PREVIEW_DEPTH_LIMIT`, `JsonTreeLabels`, `DEFAULT_LABELS`, `valueCopyMenuItems`, `objectCopyMenuItems`, `JsonPath`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import clsx from 'clsx'`；`import { useEffect, useId, useMemo, useRef, useState } from 'react'`；`import type {`；`import { IconCheckOutline16, IconCopyOutline16 } from './icons/index.tsx'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/JsonTree.tsx#L1-L664)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/Menu.tsx`**
- 源码声明的类型、组件或调用边界：`MenuItem`, `MenuSeparator`, `MenuLabel`, `MenuEntry`, `isSeparator`, `isLabel`, `MEASURE_STYLE`, `Menu`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useLayoutEffect, useRef, useState } from 'react'`；`import type { CSSProperties, ReactNode } from 'react'`；`import { createPortal } from 'react-dom'`；`import clsx from 'clsx'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/Menu.tsx#L1-L307)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/Tooltip.tsx`**
- 源码声明的类型、组件或调用边界：`TooltipSide`, `AnchorProps`, `TooltipLabel`, `Tooltip`, `colorMode`, `anchor`, `childRef`, `mergedRef`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'`；`import type { FocusEventHandler, MouseEventHandler, MutableRefObject, ReactElement, Ref } from 'reac`；`import { createPortal } from 'react-dom'`；
  - `import { useTrajectoryColorMode } from '../theme/context.tsx'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/Tooltip.tsx#L1-L174)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-trajectory/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
