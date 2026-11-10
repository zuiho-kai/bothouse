---
name: components-skillpanel-contracts-01
description: components-skillpanel 源码接口与集成边界 01：web/frontend/src/components/SkillPanel 下 DocToSkillModal.tsx、MarketplaceView.tsx、SkillDetailView.tsx、SkillGraphTab.tsx、SkillPanelWidgets.tsx、SkillToasts.tsx、UploadSkillModal.tsx、index.tsx、skillPanelUtils.ts、skillRetrievalStatus.ts、skillVersionOptions.ts、symphonyGraphAction.ts、types.ts、useSkillToasts.ts 共 14 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 14 个前端文件的静态声明，不证明运行行为；其余前端文件的声明归 components-skillpanel-contracts-02；入口说明归 components-skillpanel-overview
---
# components-skillpanel 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/DocToSkillModal.tsx`**
- 源码声明的类型、组件或调用边界：`DocToSkillModalProps`, `DocToSkillModal`, `isDocConfirmDisabled`, `file`, `file`, `rect`, `file`, `link`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { HelpCircle, Upload } from 'lucide-react';`；`import { TopAnchorTooltip } from './SkillPanelWidgets';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/DocToSkillModal.tsx#L1-L190)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/MarketplaceView.tsx`**
- 源码声明的类型、组件或调用边界：`CatalogCacheMetadata`, `PageCardActionProps`, `MarketplaceViewProps`, `MarketplaceView`, `moreItems`, `SkillPacksView`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { catalogAwaitingItems, type CatalogCacheMetadata } from '../../features/catalogCache';`；`import { useTranslation } from 'react-i18next';`；`import { ChevronRight, Loader2 } from 'lucide-react';`；`import BackIcon from '../../assets/work-mode/arrow-left.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/MarketplaceView.tsx#L1-L315)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/SkillDetailView.tsx`**
- 源码声明的类型、组件或调用边界：`EntityHeaderAvatar`, `FilePreviewContentFile`, `FilePreviewTreeNode`, `buildSkillPreviewFile`, `matched`, `skillDir`, `downloadUrl`, `MEMBER_BLOCKING_REASON_KEYS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { openAssetPublish } from '../../features/assetPublishEvents';`；`import { useTranslation } from 'react-i18next';`；`import type { ReactNode } from 'react';`；`import BackIcon from '../../assets/work-mode/arrow-left.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/SkillDetailView.tsx#L1-L806)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/SkillGraphTab.tsx`**
- 源码声明的类型、组件或调用边界：`SkillGraphPanelHandle`, `SkillGraphTabProps`, `SkillGraphTab`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { MutableRefObject } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Loader2, Music2 } from 'lucide-react';`；`import { SkillGraphPanel, type SkillGraphPanelHandle } from '../SkillGraphPanel';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/SkillGraphTab.tsx#L1-L93)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/SkillPanelWidgets.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `PageCardActionProps`, `FormFieldTooltip`, `ref`, `handleEnter`, `rect`, `handleLeave`, `TopAnchorTooltip`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useRef, useState, type ReactNode } from 'react';`；`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`；`import { ChevronRight } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/SkillPanelWidgets.tsx#L1-L273)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/SkillToasts.tsx`**
- 源码声明的类型、组件或调用边界：`SkillToastsProps`, `SkillToasts`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import type { SkillToastType } from './useSkillToasts';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/SkillToasts.tsx#L1-L112)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/UploadSkillModal.tsx`**
- 源码声明的类型、组件或调用边界：`UploadSkillModalProps`, `UploadSkillModal`, `file`, `file`, `file`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import TipIcon from '../../assets/tip.svg?react';`；`import UpFileIcon from '../../assets/upFile.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/UploadSkillModal.tsx#L1-L118)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/index.tsx`**
- 源码声明的类型、组件或调用边界：`MarketplaceSubView`, `errorToMessage`, `MY_SKILLS_EMPTY_KEY`, `MySkillsGroupHeader`, `CreateSkillMenu`, `SkillPanel`, `prevIsActiveRef`, `mountedRef`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { publicationLabel, matchesPublicationFilter } from '../../features/assetPublication';`；`import { CatalogCacheNotice } from '../marketplace/CatalogCacheNotice';`；`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；
  - `import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/index.tsx#L1-L1607)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/skillPanelUtils.ts`**
- 源码声明的类型、组件或调用边界：`SKILLS_FETCH_TIMEOUT_REFRESH_MS`, `SKILLS_FETCH_TIMEOUT_NORMAL_MS`, `GRAPH_READING_MIN_VISIBLE_MS`, `SKILL_NAME_PATTERN`, `SKILL_NAME_MAX_LEN`, `VERSION_PATTERN`, `DISPLAY_NAME_MAX_LEN`, `PREVIEWABLE_MIME_TYPES`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { MarketplacePluginItem, SkillItem } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/skillPanelUtils.ts#L1-L125)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/skillRetrievalStatus.ts`**
- 源码声明的类型、组件或调用边界：`SkillRetrievalBuildStatus`, `SkillRetrievalCandidateScale`, `SkillRetrievalStrategy`, `SkillRetrievalStatus`, `SkillRetrievalStatusContractError`, `isRecord`, `requireNonNegativeInteger`, `requireString`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/skillRetrievalStatus.ts#L1-L161)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/skillVersionOptions.ts`**
- 源码声明的类型、组件或调用边界：`SkillVersionOptionSource`, `SkillVersionOption`, `buildSkillVersionOptions`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/skillVersionOptions.ts#L1-L23)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/symphonyGraphAction.ts`**
- 源码声明的类型、组件或调用边界：`GraphActionResponse`, `SymphonyGraphPanelHandle`, `GraphActionRequest`, `SymphonyEnabledChangeResult`, `CoordinateSymphonyEnabledChangeInput`, `errorMessage`, `coordinateSymphonyEnabledChange`, `appliedWithoutRestart`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/symphonyGraphAction.ts#L1-L90)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/types.ts`**
- 源码声明的类型、组件或调用边界：`FileTreeNode`, `SkillItem`, `SkillPackBlockedMember`, `SkillPackMember`, `SkillPackProjection`, `InstalledPluginItem`, `SkillDetail`, `HubSkillDetailData`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/types.ts#L1-L238)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useSkillToasts.ts`**
- 源码声明的类型、组件或调用边界：`SkillToastType`, `SkillToastShower`, `useSkillToasts`, `messageTimerRef`, `showMessage`, `displayText`, `duration`, `cleanMessage`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useRef, useState } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useSkillToasts.ts#L1-L48)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-skillpanel/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
