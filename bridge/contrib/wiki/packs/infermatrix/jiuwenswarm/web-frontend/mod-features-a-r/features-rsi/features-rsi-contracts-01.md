---
name: features-rsi-contracts-01
description: features-rsi 源码接口与集成边界 01：features/rsi 下 RsiPage.tsx 与 components/ 目录十一个组件（ConfigInfoDialog、CreateExperimentDialog、RsiArtifactDetailDialog、RsiCanvasArea、RsiDetail、RsiDetailHeader、RsiIntroduction、RsiLatexPreview、RsiRail、RsiResultSummary、RsiSelectedInfo）的静态声明与导入
metadata:
  scope: 只收 RsiPage 与 components/ 下的页面和组件声明，不证明运行行为；featureConfig、latexPreview、mockData、rsiApi、rsiArtifactFiles、rsiPresentation、rsiStore、rsiTreeLayout、types、useRsiEvents 归 features-rsi-contracts-02，入口说明归 features-rsi-overview
---
# features-rsi 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx`**
- 源码声明的类型、组件或调用边界：`RsiPage`, `list`, `listLoading`, `listError`, `selectedTaskId`, `loadList`, `selectTask`, `upsertListItem`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { useRsiStore } from './rsiStore';`；`import { useRsiEvents } from './useRsiEvents';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx#L1-L88)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx`**
- 源码声明的类型、组件或调用边界：`ConfigInfoDialogProps`, `ConfigInfoDialog`, `ref`, `dialog`, `cfg`, `isArtifact`, `isPaper`, `isProgram`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useRef } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import type { RsiTaskGetResult } from '../types';`；`import { scenarioLabel, artifactTypeLabel } from '../rsiPresentation';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx#L1-L95)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx`**
- 源码声明的类型、组件或调用边界：`RSI_DATASET_FIELD_SCHEMA`, `DatasetFieldTipContent`, `handleCopy`, `CreateExperimentDialogProps`, `Branch`, `DEFAULT_RSI_PACKAGE_ID`, `FormState`, `defaultForm`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import clsx from 'clsx';`；`import { Check, Copy } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx#L1-L1004)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiArtifactDetailDialog.tsx`**
- 源码声明的类型、组件或调用边界：`RsiArtifactFileEntry`, `RsiArtifactSource`, `RsiArtifactDetailDialogProps`, `FileTreeNode`, `createFileTree`, `root`, `directoryMap`, `entry`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useState } from 'react';`；`import { ChevronRight, Copy, Download, File as FileIcon, Folder, LoaderCircle, X } from 'lucide-reac`；`import { useTranslation } from 'react-i18next';`；
  - `import { FilePreview } from '../../../components/ArtifactsPanel/FilePreview';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiArtifactDetailDialog.tsx#L1-L383)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiCanvasArea.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `StatusBadgeKind`, `NodeStatusKind`, `NodeIconKind`, `RsiNodePresentation`, `LayoutNode`, `RsiCanvasAreaProps`, `LEGEND`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import bestIcon from '../../../assets/rsi/rsi-best.svg';`；`import costIcon from '../../../assets/rsi/rsi-cost.svg';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiCanvasArea.tsx#L1-L1013)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiDetail.tsx`**
- 源码声明的类型、组件或调用边界：`RsiDetail`, `selectedTaskId`, `detail`, `detailLoading`, `refreshDetail`, `list`, `status`, `cancelled`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { useRsiStore } from '../rsiStore';`；`import { RsiDetailHeader } from './RsiDetailHeader';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiDetail.tsx#L1-L94)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiDetailHeader.tsx`**
- 源码声明的类型、组件或调用边界：`DesktopSaveApiResult`, `StatusBadgeKind`, `RsiActionKind`, `DownloadCapableWindow`, `RsiDetailHeaderProps`, `RsiDetailHeader`, `patchTaskStatus`, `removeListItem`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { executeDesktopSave, type DesktopSaveApiResult } from '../../../utils/desktopSave';`；`import completeIcon from '../../../assets/rsi/rsi-complete.svg';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiDetailHeader.tsx#L1-L439)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiIntroduction.tsx`**
- 源码声明的类型、组件或调用边界：`RsiIntroductionProps`, `DESIGN_WIDTH`, `MAX_SCALE`, `RsiIntroduction`, `scalerRef`, `contentRef`, `scaler`, `content`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useLayoutEffect, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import step1Image from '../../../assets/rsi/rsi-step1.svg';`；`import step2Image from '../../../assets/rsi/rsi-step2.svg';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiIntroduction.tsx#L1-L130)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiLatexPreview.tsx`**
- 源码声明的类型、组件或调用边界：`RsiLatexPreviewProps`, `LatexViewMode`, `RsiLatexPreview`, `cancelled`, `text`, `markdown`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useMemo, useState } from 'react';`；`import { LoaderCircle } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import { MarkdownRenderer } from '../../../components/MarkdownRenderer';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiLatexPreview.tsx#L1-L88)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiRail.tsx`**
- 源码声明的类型、组件或调用边界：`RsiRailProps`, `RsiRail`, `active`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import type { RsiTaskListItem } from '../types';`；`import { statusBadgeInfo, typeDisplayLabel } from '../rsiPresentation';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiRail.tsx#L1-L76)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiResultSummary.tsx`**
- 源码声明的类型、组件或调用边界：`RsiResultSummaryProps`, `RsiResultSummary`, `liveProgress`, `tree`, `score`, `baseline`, `gain`, `gainFmt`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import optimizeImage from '../../../assets/rsi/rsi-optimize.svg';`；`import type { RsiTaskGetResult, RsiReportGetResult, RsiUsageGetResult } from '../types';`；
  - `import { formatArtifactScore, formatGain, formatTokensK, presentRsiNode, typeDisplayLabel } from '..`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiResultSummary.tsx#L1-L138)。
- **`jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiSelectedInfo.tsx`**
- 源码声明的类型、组件或调用边界：`HARNESS_GROUPS`, `RsiSelectedInfoProps`, `RsiSelectedInfo`, `tree`, `task`, `selectedNodeId`, `setSelectedNode`, `selected`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import selectedInfoIcon from '../../../assets/rsi/rsi-icon.svg';`；`import { useRsiStore } from '../rsiStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiSelectedInfo.tsx#L1-L232)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-rsi/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
