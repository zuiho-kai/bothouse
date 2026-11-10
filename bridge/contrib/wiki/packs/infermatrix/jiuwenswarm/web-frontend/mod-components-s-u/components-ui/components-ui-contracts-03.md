---
name: components-ui-contracts-03
description: components-ui 源码接口 03：ui 目录下 Switch、Tabs、Tag、Textarea、Toast（含 toastStore.ts）与 ui/index.ts 共七个文件的声明、导入依赖与源码行区间
metadata:
  scope: 只收这七个文件的接口记录；Button 至 FilePreviewPanel 归 components-ui-contracts-01，FilePreviewTree 至 Select 归 components-ui-contracts-02，目录入口归 components-ui-overview
---
# components-ui 源码接口与集成边界 03

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/Switch/Switch.tsx`**
- 源码声明的类型、组件或调用边界：`ButtonHTMLAttributes`, `SwitchProps`, `Switch`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { forwardRef, type ButtonHTMLAttributes } from 'react';`；`import './Switch.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/Switch/Switch.tsx#L1-L26)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/Tabs/Tabs.tsx`**
- 源码声明的类型、组件或调用边界：`TabsItem`, `TabsProps`, `Tabs`, `classes`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AriaRole, ReactNode } from 'react';`；`import './Tabs.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/Tabs/Tabs.tsx#L1-L59)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/Tag/Tag.tsx`**
- 源码声明的类型、组件或调用边界：`HTMLAttributes`, `TagVariant`, `TagProps`, `Tag`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { type HTMLAttributes, type ReactNode } from 'react';`；`import './Tag.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/Tag/Tag.tsx#L1-L17)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/Textarea/Textarea.tsx`**
- 源码声明的类型、组件或调用边界：`TextareaHTMLAttributes`, `TextareaProps`, `Textarea`, `innerRef`, `resizeTextArea`, `el`, `handleChange`, `el`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { forwardRef, useCallback, useEffect, useRef, useImperativeHandle, type TextareaHTMLAttribute`；`import './Textarea.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/Textarea/Textarea.tsx#L1-L97)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/Toast/Toast.tsx`**
- 源码声明的类型、组件或调用边界：`ToastRecord`, `VARIANT_ICON`, `ToastItem`, `timerId`, `StatusIcon`, `hasActions`, `ToastStack`, `records`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useSyncExternalStore } from 'react';`；`import { createPortal } from 'react-dom';`；`import { AlertTriangle, CircleAlert, CircleCheck, X } from 'lucide-react';`；`import type { LucideIcon } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/Toast/Toast.tsx#L1-L82)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/Toast/toastStore.ts`**
- 源码声明的类型、组件或调用边界：`ToastAction`, `ToastVariant`, `ToastConfig`, `ToastRecord`, `DEFAULT_DURATION_SECONDS`, `TOAST_EXIT_ANIMATION_MS`, `records`, `nextKey`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/Toast/toastStore.ts#L1-L127)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/index.ts`**
- 源码声明的类型、组件或调用边界：`ButtonProps`, `CollapsibleTextProps`, `InfoCardProps`, `InputProps`, `TextareaProps`, `SelectOption`, `SwitchProps`, `RadioOption`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/index.ts#L1-L72)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-ui/source-contracts-03.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
