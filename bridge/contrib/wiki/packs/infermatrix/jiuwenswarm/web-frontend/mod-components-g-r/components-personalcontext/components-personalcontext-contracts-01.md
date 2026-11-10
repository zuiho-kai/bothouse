---
name: components-personalcontext-contracts-01
description: components-personalcontext 源码接口与集成边界 01：web/frontend/src/components/PersonalContext 下 AddContentDrawer.tsx、GraphPanel.tsx、Intro.tsx、ServicesPanel.tsx、SettingsPanel.tsx、edgeBookmarkFolders.ts、index.tsx 共 7 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 7 个前端文件的静态声明，不证明运行行为；入口说明归 components-personalcontext-overview
---
# components-personalcontext 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/PersonalContext/AddContentDrawer.tsx`**
- 源码声明的类型、组件或调用边界：`FetchProvider`, `FetchServiceConfig`, `FeishuMode`, `FeishuResource`, `GithubResource`, `GitcodeResource`, `TimeRange`, `PROVIDER_ICON`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useMemo, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { ChevronDown, Loader2, X } from 'lucide-react';`；`import { usePersonalContextStore } from '../../stores';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/PersonalContext/AddContentDrawer.tsx#L1-L1390)。
- **`jiuwenswarm/channels/web/frontend/src/components/PersonalContext/GraphPanel.tsx`**
- 源码声明的类型、组件或调用边界：`LayoutEdge`, `LayoutNode`, `ContextEdge`, `ContextNode`, `ContextSearchResultItem`, `ContextSourceDetail`, `PersonalContextGraphPanelProps`, `Transform`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { useTranslation } from 'react-i18next';`；`import { ChevronDown, Loader2, RefreshCw, Search, X } from 'lucide-react';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/PersonalContext/GraphPanel.tsx#L1-L1667)。
- **`jiuwenswarm/channels/web/frontend/src/components/PersonalContext/Intro.tsx`**
- 源码声明的类型、组件或调用边界：`INTRO_SEEN_KEY`, `isPersonalContextIntroSeen`, `PersonalContextIntroProps`, `PersonalContextIntro`, `handleStart`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import pcFeature1 from '../../assets/pc-feature-1.svg';`；`import pcFeature2 from '../../assets/pc-feature-2.svg';`；`import pcFeature3 from '../../assets/pc-feature-3.svg';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/PersonalContext/Intro.tsx#L1-L114)。
- **`jiuwenswarm/channels/web/frontend/src/components/PersonalContext/ServicesPanel.tsx`**
- 源码声明的类型、组件或调用边界：`FetchProvider`, `FetchRunProgress`, `FetchRunRecord`, `FetchServiceConfig`, `FetchServiceState`, `POLL_INTERVAL_MS`, `GRAPH_REFRESH_INTERVAL_MS`, `runTimestampValue`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Loader2, PlayCircle, Plus, X } from 'lucide-react';`；`import { Switch } from '../Switch';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/PersonalContext/ServicesPanel.tsx#L1-L735)。
- **`jiuwenswarm/channels/web/frontend/src/components/PersonalContext/SettingsPanel.tsx`**
- 源码声明的类型、组件或调用边界：`PersonalContextSettingsPanelProps`, `isRequestTimeoutError`, `isRepositoryCredentialError`, `PersonalContextSettingsPanel`, `availableModels`, `visibleModels`, `currentModelName`, `masterEnabled`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Loader2, X } from 'lucide-react';`；`import { Switch } from '../Switch';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/PersonalContext/SettingsPanel.tsx#L1-L686)。
- **`jiuwenswarm/channels/web/frontend/src/components/PersonalContext/edgeBookmarkFolders.ts`**
- 源码声明的类型、组件或调用边界：`parseEdgeBookmarkFolderPaths`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/PersonalContext/edgeBookmarkFolders.ts#L1-L3)。
- **`jiuwenswarm/channels/web/frontend/src/components/PersonalContext/index.tsx`**
- 源码声明的类型、组件或调用边界：`PersonalContextPanelProps`, `PersonalContextPanel`, `hasFetchServices`, `hasGraphNodes`, `hasContent`, `showIntro`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect } from 'react';`；`import { usePersonalContextStore } from '../../stores';`；`import { PersonalContextGraphPanel } from './GraphPanel';`；`import { PersonalContextServicesPanel } from './ServicesPanel';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/PersonalContext/index.tsx#L1-L70)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-personalcontext/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
