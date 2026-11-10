---
name: multi-session-sidebar-contracts-01
description: multi-session-sidebar 源码接口 01：multi-session/sidebar 下 ConversationSidebar、ProjectArchiveDialog、ProjectCreateMenu、SidebarActionMenu、SidebarMenu、SidebarMenu.types、projectArchiveModel、projectCreateErrors、sidebarMenuSchema、sidebarModel、useSidebarMenu 共十一个文件的声明与导入依赖
metadata:
  scope: 只收这十一个文件的接口记录；目录入口归 multi-session-sidebar-overview
---
# multi-session-sidebar 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/ConversationSidebar.tsx`**
- 源码声明的类型、组件或调用边界：`ChatRuntime`, `SidebarCronJob`, `UNREAD_KEY`, `RELATIVE_TIME_REFRESH_MS`, `NewConversationOptions`, `isDefaultProject`, `ConversationSidebarProps`, `ConversationListItemProps`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import { Check, ChevronDown, CircleAlert, Code2, Workflow } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/ConversationSidebar.tsx#L1-L1255)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/ProjectArchiveDialog.tsx`**
- 源码声明的类型、组件或调用边界：`ProjectArchiveDialogProps`, `ProjectArchiveDialog`, `titleId`, `title`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useId } from 'react';`；`import { X } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import { Button, Dialog } from '../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/ProjectArchiveDialog.tsx#L1-L73)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/ProjectCreateMenu.tsx`**
- 源码声明的类型、组件或调用边界：`ProjectCreateMode`, `ProjectCreateMenuProps`, `ProjectCreateMenu`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/ProjectCreateMenu.tsx#L1-L44)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/SidebarActionMenu.tsx`**
- 源码声明的类型、组件或调用边界：`SidebarActionMenuProps`, `SidebarActionMenu`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../comp`；`import type { SidebarMenuItem, TooltipHandlers } from './SidebarMenu.types';`；
  - `import MoreIcon from '../../assets/work-mode/more-rimless.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/SidebarActionMenu.tsx#L1-L69)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/SidebarMenu.tsx`**
- 源码声明的类型、组件或调用边界：`SidebarMenuSharedProps`, `SidebarMenuProps`, `SidebarMenu`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import type { ProjectInfo, Session } from '../../types';`；`import { SidebarActionMenu } from './SidebarActionMenu';`；`import type { TooltipHandlers } from './SidebarMenu.types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/SidebarMenu.tsx#L1-L60)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/SidebarMenu.types.ts`**
- 源码声明的类型、组件或调用边界：`SidebarMenuItem`, `TooltipHandlers`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/SidebarMenu.types.ts#L1-L18)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/projectArchiveModel.ts`**
- 源码声明的类型、组件或调用边界：`resolveProjectArchiveSessionCount`, `nonPinnedCount`, `pinnedOrdinaryCount`, `belongsToProject`, `isCronSession`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ProjectInfo, Session } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/projectArchiveModel.ts#L1-L21)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/projectCreateErrors.ts`**
- 源码声明的类型、组件或调用边界：`projectCreateErrorKey`, `message`, `code`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/projectCreateErrors.ts#L1-L16)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/sidebarMenuSchema.ts`**
- 源码声明的类型、组件或调用边界：`Translate`, `SidebarMenuItemDef`, `PIN_LABEL_PAIRS`, `getProjectMenuItems`, `batchItems`, `getSessionMenuItems`, `scope`, `pinLabels`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/sidebarMenuSchema.ts#L1-L68)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/sidebarModel.ts`**
- 源码声明的类型、组件或调用边界：`SessionIndicator`, `Translate`, `RuntimeLike`, `SessionLike`, `normalizeActivityTime`, `parsed`, `getSessionActivityAt`, `getSessionIndicator`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/sidebarModel.ts#L1-L77)。
- **`jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/useSidebarMenu.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `SidebarMenuOptions`, `RenameTarget`, `Translate`, `isDefaultProject`, `isCronSession`, `getSessionTitle`, `raw`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createElement, useRef, useState, type ReactNode } from 'react';`；`import { flushSync } from 'react-dom';`；`import { Archive } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/multi-session/sidebar/useSidebarMenu.tsx#L1-L642)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/multi-session-sidebar/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
