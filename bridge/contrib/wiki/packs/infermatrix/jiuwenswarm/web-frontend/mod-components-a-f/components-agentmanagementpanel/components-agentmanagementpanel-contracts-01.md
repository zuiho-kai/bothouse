---
name: components-agentmanagementpanel-contracts-01
description: components-agentmanagementpanel 源码接口 01：AgentManagementPanel 下 AgentEditor、AgentGroupDetailPage、AgentGroupEditor、AgentGroupMemberPicker、AgentGroupUploadDialog、AgentTagPicker、AgentUploadDialog、CatalogPage、DefinitionCard、DefinitionDetailPage、DefinitionFilePreview 共十一个文件的声明与导入依赖
metadata:
  scope: 只收这十一个文件的接口记录；GroupCard、GroupCatalogPage、SelectionPagination、useDialogFocusTrap 归 components-agentmanagementpanel-contracts-02；目录入口归 components-agentmanagementpanel-overview
---
# components-agentmanagementpanel 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentEditor.tsx`**
- 源码声明的类型、组件或调用边界：`FormEvent`, `AgentDraft`, `McpOption`, `RequestStatus`, `SkillOption`, `AgentEditorProps`, `AgentEditor`, `personaSurfaceRef`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Check, ChevronDown, ChevronUp, Minus, Plus, Trash2 } from 'lucide-react';`；`import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`；
  - `import SearchIcon from '../../assets/agent-management/agent-search.svg?react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentEditor.tsx#L1-L795)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupDetailPage.tsx`**
- 源码声明的类型、组件或调用边界：`AgentGroupDetailPageProps`, `AgentGroupDetailPage`, `canUse`, `canDelete`, `canPreviewFiles`, `category`, `categoryLabel`, `detailTags`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import { openAssetPublish } from '../../features/assetPublishEvents';`；`import { canShowAssetPublish } from '../../features/assetPublishState';`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupDetailPage.tsx#L1-L385)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupEditor.tsx`**
- 源码声明的类型、组件或调用边界：`FormEvent`, `AgentCatalogItem`, `AgentGroupDraft`, `RequestStatus`, `SkillOption`, `AgentGroupEditorProps`, `AgentGroupEditor`, `leaderPickerTriggerRef`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';`；`import { ArrowLeftRight, Check, ChevronDown, ChevronUp, Minus, Plus, Trash2 } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupEditor.tsx#L1-L634)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupMemberPicker.tsx`**
- 源码声明的类型、组件或调用边界：`AgentCatalogItem`, `RequestStatus`, `AgentGroupMemberPickerProps`, `AgentOptionAvatar`, `avatarUrl`, `AgentGroupMemberPicker`, `filteredAgents`, `normalized`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo, useState } from 'react';`；`import { Check, LoaderCircle, Plus } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupMemberPicker.tsx#L1-L250)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupUploadDialog.tsx`**
- 源码声明的类型、组件或调用边界：`LocalFilePick`, `AgentGroupUploadDialogProps`, `DROP_ACCEPT_WINDOW_MS`, `formatFileSize`, `units`, `index`, `size`, `pickFromDroppedFile`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createPortal } from 'react-dom';`；`import { useCallback, useEffect, useRef, useState } from 'react';`；`import { FileArchive, Info, Loader2, X } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupUploadDialog.tsx#L1-L336)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentTagPicker.tsx`**
- 源码声明的类型、组件或调用边界：`AgentTagPickerProps`, `AgentTagPicker`, `pickerRef`, `valuesRef`, `valueSignature`, `updateScrollState`, `values`, `values`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';`；`import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；
  - `import { AGENT_TAG_OPTIONS } from '../../features/agentManagement/tagOptions';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentTagPicker.tsx#L1-L222)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentUploadDialog.tsx`**
- 源码声明的类型、组件或调用边界：`LocalFilePick`, `AgentUploadDialogProps`, `DROP_ACCEPT_WINDOW_MS`, `formatFileSize`, `units`, `unitIndex`, `size`, `pickFromDroppedFile`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createPortal } from 'react-dom';`；`import { useCallback, useEffect, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { FileArchive, Info, Loader2, X } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentUploadDialog.tsx#L1-L294)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/CatalogPage.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `AgentCatalogItem`, `AGENT_PAGE_SIZE`, `CATEGORIES`, `CatalogPageProps`, `CatalogPage`, `isMine`, `totalPages`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { type ReactNode } from 'react';`；`import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import { type AgentCatalogItem, type RequestStatus } from '../../features/agentManagement';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/CatalogPage.tsx#L1-L254)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/DefinitionCard.tsx`**
- 源码声明的类型、组件或调用边界：`AgentCatalogItem`, `DefinitionCardProps`, `getAvatarLetter`, `TagSummaryProps`, `TagSummary`, `metaRef`, `measureRef`, `tagList`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useLayoutEffect, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Ellipsis } from 'lucide-react';`；`import { getAgentAvatarUrl, type AgentCatalogItem } from '../../features/agentManagement';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/DefinitionCard.tsx#L1-L256)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/DefinitionDetailPage.tsx`**
- 源码声明的类型、组件或调用边界：`AgentFileContent`, `AgentDetail`, `DefinitionFileEntry`, `RequestStatus`, `DefinitionDetailPageProps`, `DefinitionDetailPage`, `loading`, `avatarUrl`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { PublicationDetailStatus } from '../marketplace/PublicationDetailStatus';`；`import { openAssetPublish } from '../../features/assetPublishEvents';`；`import { canShowAssetPublish } from '../../features/assetPublishState';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/DefinitionDetailPage.tsx#L1-L363)。
- **`jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/DefinitionFilePreview.tsx`**
- 源码声明的类型、组件或调用边界：`FilePreviewContentFile`, `FilePreviewTreeNode`, `DefinitionFilePreviewProps`, `toPreviewTreeNodes`, `findDefaultDefinitionFile`, `DefinitionFilePreview`, `nodes`, `selectedIsPreviewable`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import type { AgentFileContent, DefinitionFileEntry, RequestStatus } from '../../features/agentManag`；`import { isPreviewableFile } from '../../features/agentManagement';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/DefinitionFilePreview.tsx#L1-L116)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-agentmanagementpanel/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
