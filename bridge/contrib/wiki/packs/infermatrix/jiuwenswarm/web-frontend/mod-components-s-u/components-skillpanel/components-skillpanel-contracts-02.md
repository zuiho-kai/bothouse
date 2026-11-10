---
name: components-skillpanel-contracts-02
description: components-skillpanel 源码接口与集成边界 02：web/frontend/src/components/SkillPanel 下 useEvolution.ts、useHubMarketplace.ts、useRetrievalIndexBuild.ts、useSkillFilesTab.tsx、useSymphonyGraph.ts 共 5 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 5 个前端文件的静态声明，不证明运行行为；其余前端文件的声明归 components-skillpanel-contracts-01；入口说明归 components-skillpanel-overview
---
# components-skillpanel 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useEvolution.ts`**
- 源码声明的类型、组件或调用边界：`UseEvolutionParams`, `useEvolution`, `evolutionSaveTimerRef`, `sortedEvolutionEntries`, `ta`, `tb`, `fetchEvolutionEntries`, `data`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { webRequest } from '../../services/webClient';`；`import type { EvolutionEntry, EvolutionGetResponse, LoadState, SkillDetail } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useEvolution.ts#L1-L144)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useHubMarketplace.ts`**
- 源码声明的类型、组件或调用边界：`CatalogCacheMetadata`, `CatalogItems`, `HUB_HOME_TOP_K`, `HUB_MORE_TOP_K`, `HubRecommendSkill`, `mapRecommendSkill`, `WithSessionFn`, `SkillPanelTab`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { webRequest } from '../../services/webClient';`；`import type { HubSkillDetail, LoadState, MarketplacePluginItem } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useHubMarketplace.ts#L1-L604)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useRetrievalIndexBuild.ts`**
- 源码声明的类型、组件或调用边界：`UseRetrievalIndexBuildParams`, `useRetrievalIndexBuild`, `startRetrievalIndexBuild`, `statusPayload`, `status`, `payload`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { webRequest } from '../../services/webClient';`；`import { canBuildSkillRetrievalIndex, parseSkillRetrievalStatus } from './skillRetrievalStatus';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useRetrievalIndexBuild.ts#L1-L47)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useSkillFilesTab.tsx`**
- 源码声明的类型、组件或调用边界：`FilePreviewTreeNode`, `WithSessionFn`, `UseSkillFilesTabParams`, `MutablePreviewNode`, `toPreviewTreeNodes`, `root`, `dirMap`, `entry`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useMemo, useRef, useState } from 'react';`；`import { webRequest } from '../../services/webClient';`；`import { isFilePreviewable } from './skillPanelUtils';`；`import { findDefaultPreviewFile, type FilePreviewTreeNode } from '../ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useSkillFilesTab.tsx#L1-L146)。
- **`jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useSymphonyGraph.ts`**
- 源码声明的类型、组件或调用边界：`UseSymphonyGraphParams`, `useSymphonyGraph`, `skillGraphPanelRef`, `graphReadingStartedAtRef`, `graphReadingTimerRef`, `clearGraphActionError`, `updateSymphonyEnabled`, `result`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { webRequest } from '../../services/webClient';`；`import type { SkillGraphPanelHandle } from '../SkillGraphPanel';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useSymphonyGraph.ts#L1-L124)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-skillpanel/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
