---
name: channels-web-contracts-01
description: channels-web 源码接口与集成边界 01：web/frontend/src/features/a2ui 下 A2UIErrorBoundary、A2UIMessageContent、六个 *WithDefaults 组件（CheckBox、DateTimeInput、MultipleChoice、Slider、TextField、Text）、a2uiContent、actionBridge、actionDefaults、featureConfig、fieldBinding 共十三个前端文件的静态声明
metadata:
  scope: 只收字母序前十三个前端文件的静态声明，不证明运行行为；formDefaults 与 rendererRegistry 归 channels-web-contracts-02，入口说明归 channels-web-overview
---
# channels-web 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIErrorBoundary.tsx`**
- 源码声明的类型、组件或调用边界：`ErrorInfo`, `A2UIErrorBoundaryProps`, `A2UIErrorBoundaryState`, `A2UIErrorBoundary`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Component, type ErrorInfo, type ReactNode } from 'react';`；`import { a2uiError } from './formDefaults';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIErrorBoundary.tsx#L1-L53)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx`**
- 源码声明的类型、组件或调用边界：`A2UIContentPart`, `A2UIMessageContentProps`, `RenderPart`, `safeNamespace`, `stableHash`, `hash`, `index`, `A2UIMessageContent`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useMemo, memo } from 'react';`；`import { useA2UIActions } from '@a2ui/react';`；`import { useTranslation } from 'react-i18next';`；`import { MarkdownRenderer } from '../../components/MarkdownRenderer';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx#L1-L211)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/CheckBoxWithDefaults.tsx`**
- 源码声明的类型、组件或调用边界：`A2UIComponentProps`, `AnyComponentNode`, `CheckBoxNodeLike`, `CheckBoxWithDefaults`, `props`, `id`, `label`, `readBoolean`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useId } from 'react';`；`import type { ChangeEvent } from 'react';`；`import {`；`import { hostWeightStyle, useA2UIBoundValue } from './fieldBinding';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/CheckBoxWithDefaults.tsx#L1-L70)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/DateTimeInputWithDefaults.tsx`**
- 源码声明的类型、组件或调用边界：`A2UIComponentProps`, `AnyComponentNode`, `DateTimeInputNodeLike`, `DateInputKind`, `dateInputKind`, `dateInputLabel`, `DateTimeInputWithDefaults`, `props`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useId } from 'react';`；`import type { ChangeEvent } from 'react';`；`import {`；`import { hostWeightStyle, useA2UIBoundValue } from './fieldBinding';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/DateTimeInputWithDefaults.tsx#L1-L77)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx`**
- 源码声明的类型、组件或调用边界：`A2UIComponentProps`, `AnyComponentNode`, `DataValue`, `MultipleChoiceNodeLike`, `choiceValueToString`, `nonEmptyChoiceValue`, `text`, `selectedValuesFromData`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useId, useMemo, useState } from 'react';`；`import type { CSSProperties, ChangeEvent } from 'react';`；`import {`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx#L1-L288)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/SliderWithDefaults.tsx`**
- 源码声明的类型、组件或调用边界：`A2UIComponentProps`, `AnyComponentNode`, `SliderNodeLike`, `numberFromModel`, `SliderWithDefaults`, `props`, `id`, `minValue`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useId } from 'react';`；`import type { ChangeEvent } from 'react';`；`import {`；`import { hostWeightStyle, useA2UIBoundValue } from './fieldBinding';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/SliderWithDefaults.tsx#L1-L79)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/TextFieldWithDefaults.tsx`**
- 源码声明的类型、组件或调用边界：`A2UIComponentProps`, `AnyComponentNode`, `TextFieldNodeLike`, `TextControlKind`, `textControlKind`, `extraProps`, `htmlInputType`, `TextFieldWithDefaults`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useId, useState } from 'react';`；`import type { ChangeEvent, HTMLInputTypeAttribute } from 'react';`；`import {`；`import { hostWeightStyle, useA2UIBoundValue } from './fieldBinding';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/TextFieldWithDefaults.tsx#L1-L100)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/TextWithDefaults.tsx`**
- 源码声明的类型、组件或调用边界：`A2UIComponentProps`, `AnyComponentNode`, `TextNodeLike`, `TextUsageHint`, `ClassMap`, `textClassMap`, `TextWithDefaults`, `props`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo } from 'react';`；`import type { CSSProperties } from 'react';`；`import ReactMarkdown from 'react-markdown';`；`import remarkGfm from 'remark-gfm';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/TextWithDefaults.tsx#L1-L68)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/a2uiContent.ts`**
- 源码声明的类型、组件或调用边界：`A2UI_PROTOCOL_VERSION`, `A2UI_OPEN_TAG`, `A2UI_CLOSE_TAG`, `A2UI_MESSAGE_KEYS`, `A2UIProtocolVersion`, `A2UIContentPart`, `ParseA2UIContentOptions`, `DEFAULT_PENDING_TEXT`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ServerToClientMessage } from '@a2ui/react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/a2uiContent.ts#L1-L384)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts`**
- 源码声明的类型、组件或调用边界：`A2UIClientEventContent`, `A2UIActionHandler`, `currentHandler`, `inFlightActionKeys`, `inFlightActionKey`, `userAction`, `surfaceId`, `sourceComponentId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { A2UIClientEventMessage } from '@a2ui/react';`；`import { isA2UIFeatureEnabled } from './featureConfig';`；`import { A2UI_PROTOCOL_VERSION } from './a2uiContent';`；`import { enrichA2UIClientEventWithDefaults } from './actionDefaults';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts#L1-L199)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/actionDefaults.ts`**
- 源码声明的类型、组件或调用边界：`UnknownRecord`, `ActionDefaultEntry`, `actionDefaults`, `surfaceDefaultsByPath`, `componentType`, `componentProps`, `type`, `actionName`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { A2UIClientEventMessage, ServerToClientMessage } from '@a2ui/react';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/actionDefaults.ts#L1-L226)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/featureConfig.ts`**
- 源码声明的类型、组件或调用边界：`a2uiFeatureEnabled`, `a2uiFeatureListeners`, `setA2UIFeatureEnabled`, `isA2UIFeatureEnabled`, `subscribeA2UIFeatureEnabled`, `useA2UIFeatureEnabled`, `normalizeA2UIEnabled`, `text`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useSyncExternalStore } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/featureConfig.ts#L1-L43)。
- **`jiuwenswarm/channels/web/frontend/src/features/a2ui/fieldBinding.ts`**
- 源码声明的类型、组件或调用边界：`ReadModelValue`, `WriteModelValue`, `BoundValueOptions`, `alwaysSeedInitial`, `hostWeightStyle`, `useA2UIBoundValue`, `shouldSeed`, `storedValue`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useState } from 'react';`；`import type { CSSProperties } from 'react';`；`import type { DataValue } from '@a2ui/react';`；`import { dualWriteA2UIValue } from './formDefaults';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/fieldBinding.ts#L1-L72)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/a2ui/channels-web/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
