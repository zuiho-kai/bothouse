---
name: components-ui-contracts-01
description: components-ui 源码接口 01：ui 目录下 Button、CategoryTabs、CloseButton、CollapsibleText、DetailPromptChip、DetailSection、Dialog、DropdownMenu（含 index.ts）、EntityAvatar、EntityHeader 与 FilePreviewPanel 的 FilePreviewContent、FilePreviewIcon、FilePreviewPanel 共十四个文件的声明、导入依赖与源码行区间
metadata:
  scope: 只收这十四个文件的接口记录；FilePreviewTree 起的文件归 components-ui-contracts-02 各部分，Switch 起的文件归 components-ui-contracts-03，目录入口归 components-ui-overview
---
# components-ui 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/Button/Button.tsx`**
- 源码声明的类型、组件或调用边界：`ButtonHTMLAttributes`, `ButtonBaseProps`, `TextButtonProps`, `IconButtonProps`, `ButtonProps`, `Button`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';`；`import { Loading } from '../Loading/Loading';`；`import './Button.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/Button/Button.tsx#L1-L50)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/CategoryTabs/CategoryTabs.tsx`**
- 源码声明的类型、组件或调用边界：`CategoryTabsOption`, `CategoryTabsProps`, `CategoryTabs`, `scrollByPage`, `el`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import { useLayoutEffect } from 'react';`；`import { ChevronLeft, ChevronRight } from 'lucide-react';`；`import { useHorizontalScrollEdges } from '../../../hooks';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/CategoryTabs/CategoryTabs.tsx#L1-L81)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/CloseButton/CloseButton.tsx`**
- 源码声明的类型、组件或调用边界：`CloseButton`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/CloseButton/CloseButton.tsx#L1-L25)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/CollapsibleText/CollapsibleText.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `CollapsibleTextProps`, `CollapsibleText`, `contentRef`, `content`, `updateOverflow`, `lineHeight`, `nextOverflowing`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';`；`import './CollapsibleText.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/CollapsibleText/CollapsibleText.tsx#L1-L55)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/DetailPromptChip/DetailPromptChip.tsx`**
- 源码声明的类型、组件或调用边界：`DetailPromptChipProps`, `DetailPromptChip`, `classes`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/DetailPromptChip/DetailPromptChip.tsx#L1-L45)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/DetailSection/DetailSection.tsx`**
- 源码声明的类型、组件或调用边界：`DetailSectionProps`, `DetailSection`, `classes`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import './DetailSection.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/DetailSection/DetailSection.tsx#L1-L22)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/Dialog/Dialog.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `Dialog`, `dialogRef`, `pressedOnBackdrop`, `dialog`, `onBackdrop`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useRef, type ReactNode } from 'react';`；`import './Dialog.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/Dialog/Dialog.tsx#L1-L50)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/DropdownMenu/DropdownMenu.tsx`**
- 源码声明的类型、组件或调用边界：`ButtonHTMLAttributes`, `CSSProperties`, `HTMLAttributes`, `KeyboardEvent`, `MouseEvent`, `MutableRefObject`, `ReactElement`, `ReactNode`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { createPortal } from 'react-dom';`；`import './DropdownMenu.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/DropdownMenu/DropdownMenu.tsx#L1-L385)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/DropdownMenu/index.ts`**
- 源码声明的类型、组件或调用边界：`DropdownMenuSide`, `DropdownMenuAlign`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/DropdownMenu/index.ts#L1-L8)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/EntityAvatar/EntityAvatar.tsx`**
- 源码声明的类型、组件或调用边界：`EntityAvatarProps`, `EntityAvatar`, `fallback`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { getSkillAvatar } from '../../../utils/skillAvatar';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/EntityAvatar/EntityAvatar.tsx#L1-L43)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/EntityHeader/EntityHeader.tsx`**
- 源码声明的类型、组件或调用边界：`MouseEvent`, `EntityImageAvatar`, `EntityHeaderAvatar`, `EntityHeaderTagItem`, `EntityHeaderTag`, `normalizeTag`, `EntityTag`, `isEntityImageAvatar`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { type MouseEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react';`；`import { EntityAvatar } from '../EntityAvatar/EntityAvatar';`；`import { useAdaptiveTooltip } from '../../../hooks/useAdaptiveTooltip';`；`import './EntityHeader.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/EntityHeader/EntityHeader.tsx#L1-L205)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewContent.tsx`**
- 源码声明的类型、组件或调用边界：`FilePreviewStatus`, `FilePreviewContentFile`, `FilePreviewContentLabels`, `FilePreviewContentProps`, `FilePreviewContent`, `isMarkdown`, `isPython`, `isJson`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo, useState } from 'react';`；`import { ArrowDownToLine } from 'lucide-react';`；`import { MarkdownRenderer } from '../../MarkdownRenderer';`；`import { CodePreview } from '../../ArtifactsPanel/CodePreview';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewContent.tsx#L1-L217)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewIcon.tsx`**
- 源码声明的类型、组件或调用边界：`FilePreviewIconType`, `SvgComponent`, `FILE_PREVIEW_ICON_COMPONENTS`, `FilePreviewIconProps`, `FilePreviewIcon`, `iconType`, `Icon`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ComponentType, SVGProps } from 'react';`；`import archiveIcon from '../../../assets/file-preview/archive.svg?react';`；`import audioIcon from '../../../assets/file-preview/audio.svg?react';`；`import codeIcon from '../../../assets/file-preview/code.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewIcon.tsx#L1-L54)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewPanel.tsx`**
- 源码声明的类型、组件或调用边界：`FilePreviewPanelProps`, `FilePreviewPanel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import './FilePreviewPanel.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewPanel.tsx#L1-L22)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-ui/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
