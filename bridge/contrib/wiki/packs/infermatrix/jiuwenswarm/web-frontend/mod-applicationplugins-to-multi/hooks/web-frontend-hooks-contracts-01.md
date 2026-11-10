---
name: web-frontend-hooks-contracts-01
description: hooks 源码接口 01：src/hooks 下 useAdaptiveTooltip、useAssetPublication、useAssetPublish、useDesktopLocalFilePickerReady、useFullscreenPanel、useHorizontalScrollEdges、useResponsive、useSpeech 八个 hook 文件的声明与导入依赖
metadata:
  scope: 只收这八个 hook 文件的接口记录；目录入口归 web-frontend-hooks-overview
---
# hooks 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/hooks/useAdaptiveTooltip.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `VIEWPORT_MARGIN`, `TOOLTIP_GAP`, `TooltipPlacement`, `TooltipAlign`, `TooltipState`, `TooltipHandlers`, `UseAdaptiveTooltipOptions`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject }`；`import { createPortal } from 'react-dom';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAdaptiveTooltip.tsx#L1-L218)。
- **`jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublication.ts`**
- 源码声明的类型、组件或调用边界：`PublicationState`, `publicationKey`, `useAssetPublication`, `signature`, `refresh`, `cancelled`, `keys`, `valid`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { assetPublishApi } from '../services/assetPublishApi';`；`import { type PublicationState } from '../features/assetPublication';`；`import type { AssetReference } from '../types/assetPublish';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublication.ts#L1-L47)。
- **`jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts`**
- 源码声明的类型、组件或调用边界：`PUBLISH_RESTORE_KEY`, `emptyMetadata`, `authScope`, `useAssetPublish`, `activeSubmission`, `updateSubmission`, `active`, `locked`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { webClient } from '../services/webClient';`；`import { useCallback, useEffect, useRef, useState } from 'react';`；`import { assetPublishApi } from '../services/assetPublishApi';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublish.ts#L1-L286)。
- **`jiuwenswarm/channels/web/frontend/src/hooks/useDesktopLocalFilePickerReady.ts`**
- 源码声明的类型、组件或调用边界：`useDesktopLocalFilePickerReady`, `markReady`, `onReady`, `intervalId`, `timeoutId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useDesktopLocalFilePickerReady.ts#L1-L53)。
- **`jiuwenswarm/channels/web/frontend/src/hooks/useFullscreenPanel.ts`**
- 源码声明的类型、组件或调用边界：`FullscreenPanelResult`, `useFullscreenPanel`, `ref`, `enter`, `el`, `exit`, `toggle`, `el`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useRef, useState } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useFullscreenPanel.ts#L1-L58)。
- **`jiuwenswarm/channels/web/frontend/src/hooks/useHorizontalScrollEdges.ts`**
- 源码声明的类型、组件或调用边界：`HorizontalScrollEdgesResult`, `useHorizontalScrollEdges`, `ref`, `update`, `el`, `next`, `el`, `observer`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useLayoutEffect, useRef, useState } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useHorizontalScrollEdges.ts#L1-L37)。
- **`jiuwenswarm/channels/web/frontend/src/hooks/useResponsive.ts`**
- 源码声明的类型、组件或调用边界：`RefObject`, `BreakpointKey`, `useMediaQuery`, `mql`, `handler`, `useMaxWidth`, `useMinWidth`, `useResponsiveLayout`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';`；`import { breakpoints, canFitBoth, canFitToolPanelOnly, type BreakpointKey } from '../styles/breakpoi`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useResponsive.ts#L1-L202)。
- **`jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts`**
- 源码声明的类型、组件或调用边界：`UseSpeechRecognitionOptions`, `UseSpeechRecognitionReturn`, `SpeechRecognitionEventMap`, `SpeechRecognitionInstance`, `SpeechRecognitionConstructor`, `Window`, `SpeechRecognition`, `useSpeechRecognition`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState, useCallback, useRef, useEffect } from 'react';`；`import i18n from '../i18n';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useSpeech.ts#L1-L392)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/hooks/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
