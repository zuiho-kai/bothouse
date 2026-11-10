---
name: components-agentmanagementpanel-contracts-02
description: components-agentmanagementpanel 源码接口 02：AgentManagementPanel 下 GroupCard、GroupCatalogPage、SelectionPagination、useDialogFocusTrap 四个文件的声明与导入依赖
metadata:
  scope: 只收这四个文件的接口记录；其余文件归 components-agentmanagementpanel-contracts-01；目录入口归 components-agentmanagementpanel-overview
---
# components-agentmanagementpanel 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/GroupCard.tsx`**
- 源码声明的类型、组件或调用边界：`GroupCardProps`, `getAvatarTone`, `seed`, `GroupAvatar`, `avatarUrl`, `GroupCard`, `canUse`, `canInstall`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import type { AgentGroupCatalogItem } from '../../features/agentManagement';`；`import { PageCard } from '../ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/GroupCard.tsx#L1-L109)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/GroupCatalogPage.tsx`**
- 源码声明的类型、组件或调用边界：`GROUP_CATEGORIES`, `PAGE_SIZE`, `GroupCatalogPageProps`, `GroupCatalogPage`, `isMine`, `isEmpty`, `hasQuery`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { ChevronLeft, ChevronRight } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import type { AgentGroupCatalogItem, RequestStatus } from '../../features/agentManagement';`；`import { CategoryTabs } from '../ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/GroupCatalogPage.tsx#L1-L174)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/SelectionPagination.tsx`**
- 源码声明的类型、组件或调用边界：`SELECTION_PAGE_SIZE`, `SelectionPaginationState`, `useSelectionPagination`, `totalPages`, `page`, `SelectionPaginationProps`, `SelectionPagination`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { ChevronLeft, ChevronRight } from 'lucide-react';`；`import { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/SelectionPagination.tsx#L1-L89)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/useDialogFocusTrap.ts`**
- 源码声明的类型、组件或调用边界：`RefObject`, `FOCUSABLE_SELECTOR`, `DialogFocusTrapOptions`, `useDialogFocusTrap`, `onEscapeRef`, `escapeDisabledRef`, `dialog`, `activeElement`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useRef, type RefObject } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/useDialogFocusTrap.ts#L1-L78)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-agentmanagementpanel/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
