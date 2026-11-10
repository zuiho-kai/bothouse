---
name: components-ui-contracts-02
description: components-ui 源码接口 02：ui 目录下 FilePreviewTree、filePreviewShared、FormDrawer、HelpTips、InfoCard、Input、Loading、LoadingSpinner、MarkdownPane、PageCard、PageHeader、PageToolbar、PageToolbarSearch、RadioGroup、Select 共十五个文件的声明、导入依赖与源码行区间
metadata:
  scope: 只收这十五个文件的接口记录；Button 至 FilePreviewPanel 归 components-ui-contracts-01，Switch 起归 components-ui-contracts-03，目录入口归 components-ui-overview
---
# components-ui 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewTree.tsx`**
- 源码声明的类型、组件或调用边界：`FilePreviewStatus`, `FilePreviewTreeNode`, `FilePreviewTreeLabels`, `FilePreviewTreeProps`, `findExpandedDirectories`, `expanded`, `visit`, `item`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { ChevronDown, ChevronRight } from 'lucide-react';`；`import FolderAssetIcon from '../../../assets/work-mode/folder.svg?react';`；`import FolderFoldAssetIcon from '../../../assets/work-mode/folder-fold.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewTree.tsx#L1-L250)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/filePreviewShared.ts`**
- 源码声明的类型、组件或调用边界：`DesktopSaveApiResult`, `FilePreviewStatus`, `FilePreviewIconType`, `CODE_FILE_PATTERN`, `IMAGE_FILE_PATTERN`, `MARKDOWN_FILE_PATTERN`, `getPreviewFileLabel`, `isCodeFileName`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { executeDesktopSave, type DesktopSaveApiResult } from '../../../utils/desktopSave';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/filePreviewShared.ts#L1-L263)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/FormDrawer/FormDrawer.tsx`**
- 源码声明的类型、组件或调用边界：`FormDrawerProps`, `FormDrawer`, `drawerStyle`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode, Ref } from 'react';`；`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`；`import { Loader2 } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/FormDrawer/FormDrawer.tsx#L1-L98)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/HelpTips/HelpTips.tsx`**
- 源码声明的类型、组件或调用边界：`HelpTips`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import './HelpTips.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/HelpTips/HelpTips.tsx#L1-L8)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/InfoCard/InfoCard.tsx`**
- 源码声明的类型、组件或调用边界：`InfoCardProps`, `InfoCard`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Plus } from 'lucide-react';`；`import type { HTMLAttributes, ReactNode } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/InfoCard/InfoCard.tsx#L1-L60)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/Input/Input.tsx`**
- 源码声明的类型、组件或调用边界：`ChangeEvent`, `FocusEvent`, `InputHTMLAttributes`, `MouseEvent`, `ReactNode`, `Ref`, `PasswordVisibilityLabels`, `AllowClearConfig`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { Eye, EyeOff, X } from 'lucide-react';`；`import './Input.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/Input/Input.tsx#L1-L249)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/Loading/Loading.tsx`**
- 源码声明的类型、组件或调用边界：`Loading`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Loader2 } from 'lucide-react';`；`import './Loading.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/Loading/Loading.tsx#L1-L18)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/LoadingSpinner/LoadingSpinner.tsx`**
- 源码声明的类型、组件或调用边界：`LoadingSpinnerProps`, `LoadingSpinner`, `uid`, `maskId`, `clipId`, `gradientId`, `filterId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useId } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/LoadingSpinner/LoadingSpinner.tsx#L1-L62)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/MarkdownPane/MarkdownPane.tsx`**
- 源码声明的类型、组件或调用边界：`MarkdownPaneProps`, `MarkdownPane`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import { MarkdownRenderer } from '../../MarkdownRenderer';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/MarkdownPane/MarkdownPane.tsx#L1-L20)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/PageCard/PageCard.tsx`**
- 源码声明的类型、组件或调用边界：`KeyboardEvent`, `EntityHeaderAvatar`, `PageCardActionProps`, `PageCardAvatar`, `PageCardProps`, `PageCard`, `classNames`, `hasLabel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';`；`import { EntityHeader, type EntityHeaderAvatar } from '../EntityHeader/EntityHeader';`；`import { useAdaptiveTooltip } from '../../../hooks/useAdaptiveTooltip';`；`import './PageCard.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/PageCard/PageCard.tsx#L1-L133)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/PageHeader/PageHeader.tsx`**
- 源码声明的类型、组件或调用边界：`PageHeaderProps`, `PageHeader`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/PageHeader/PageHeader.tsx#L1-L23)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/PageToolbar/PageToolbar.tsx`**
- 源码声明的类型、组件或调用边界：`PageToolbarProps`, `PageToolbar`, `classes`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AriaRole, CSSProperties, ReactNode } from 'react';`；`import './PageToolbar.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/PageToolbar/PageToolbar.tsx#L1-L20)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/PageToolbarSearch/PageToolbarSearch.tsx`**
- 源码声明的类型、组件或调用边界：`InputHTMLAttributes`, `PageToolbarSearchProps`, `WIDTH_STEPS`, `resolveWrapperWidth`, `PageToolbarSearch`, `wrapperRef`, `container`, `observer`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/PageToolbarSearch/PageToolbarSearch.tsx#L1-L78)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/RadioGroup/RadioGroup.tsx`**
- 源码声明的类型、组件或调用边界：`RadioOption`, `RadioGroup`, `name`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useId } from 'react';`；`import './RadioGroup.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/RadioGroup/RadioGroup.tsx#L1-L46)。
- **`jiuwenswarm/channels/web/frontend/src/components/ui/Select/Select.tsx`**
- 源码声明的类型、组件或调用边界：`ButtonHTMLAttributes`, `CSSProperties`, `KeyboardEvent`, `ReactNode`, `SelectOption`, `SelectProps`, `TRIGGER_GAP`, `VIEWPORT_MARGIN`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { createPortal } from 'react-dom';`；`import './Select.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ui/Select/Select.tsx#L1-L271)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-ui/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
