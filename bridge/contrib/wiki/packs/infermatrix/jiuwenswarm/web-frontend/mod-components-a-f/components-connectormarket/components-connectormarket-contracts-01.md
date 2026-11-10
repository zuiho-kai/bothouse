---
name: components-connectormarket-contracts-01
description: components-connectormarket 源码接口与集成边界 01：web/frontend/src/components/ConnectorMarket 下 Buttons.tsx、CliAuthModal.tsx、ConfirmDialog.tsx、ConnectTokenModal.tsx、CreatePluginPage.tsx、EntityAvatar.tsx、FormPageLayout.tsx、MarketCard.tsx、MarketplacePage.tsx、McpDetailPage.tsx、MyMarketCard.tsx、PickerModal.tsx、PluginDetailPage.tsx 共 13 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 13 个前端文件的静态声明，不证明运行行为；其余前端文件的声明归 components-connectormarket-contracts-02；入口说明归 components-connectormarket-overview
---
# components-connectormarket 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/Buttons.tsx`**
- 源码声明的类型、组件或调用边界：`PillButton`, `DetailLinkButton`, `IconAvatar`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/Buttons.tsx#L1-L68)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/CliAuthModal.tsx`**
- 源码声明的类型、组件或调用边界：`CliAuthModalProps`, `CliAuthModal`, `waitAuth`, `requestSeqRef`, `seq`, `handleManualOpen`, `handleRetry`, `handleCancel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useRef, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`；`import { X, ExternalLink, Loader2, CheckCircle2, RotateCw } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/CliAuthModal.tsx#L1-L176)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/ConfirmDialog.tsx`**
- 源码声明的类型、组件或调用边界：`ConfirmDialogProps`, `ConfirmDialog`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/ConfirmDialog.tsx#L1-L51)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/ConnectTokenModal.tsx`**
- 源码声明的类型、组件或调用边界：`ConnectTokenModalProps`, `ConnectTokenModal`, `saveCredentialsAndConnect`, `requiredTokens`, `fields`, `allFilled`, `avatar`, `handleSubmit`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`；`import { X, Loader2, ExternalLink } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/ConnectTokenModal.tsx#L1-L155)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/CreatePluginPage.tsx`**
- 源码声明的类型、组件或调用边界：`PickerItem`, `DESCRIPTION_MAX`, `AVATAR_UPLOAD_ENABLED`, `RequiredFieldKey`, `SkillItem`, `InstalledPluginItem`, `CreatePluginPageProps`, `toSkillPickerItems`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useMemo, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { ImagePlus, Trash2, Plus } from 'lucide-react';`；`import { webRequest } from '../../services/webClient';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/CreatePluginPage.tsx#L1-L450)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/EntityAvatar.tsx`**
- 源码声明的类型、组件或调用边界：`EntityAvatarProps`, `EntityAvatar`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import type { AvatarStyle } from '../../utils/skillAvatar';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/EntityAvatar.tsx#L1-L28)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/FormPageLayout.tsx`**
- 源码声明的类型、组件或调用边界：`FormPageLayoutProps`, `FormPageLayout`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { ChevronLeft, Loader2 } from 'lucide-react';`；`import './FormPageLayout.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/FormPageLayout.tsx#L1-L91)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/MarketCard.tsx`**
- 源码声明的类型、组件或调用边界：`MarketCardProps`, `MarketCard`, `avatarProp`, `titleEndNode`, `actionSlot`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import './ConnectorMarket.css';`；`import { Loader2, AlertCircle } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import { PageCard } from '../ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/MarketCard.tsx#L1-L99)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/MarketplacePage.tsx`**
- 源码声明的类型、组件或调用边界：`InstallationFilter`, `PluginPackageSummary`, `MarketKind`, `TopTab`, `MarketplacePageProps`, `CATEGORY_TOP_N`, `PAGE_SIZE_ALL`, `PAGE_SIZE_OPTIONS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import SimpleSelect from '../CronPanel/SimpleSelect';`；`import { InstallationFilterSelect, matchesInstallation, type InstallationFilter } from '../marketpla`；`import { catalogCacheOf } from '../../features/catalogCache';`；
  - `import { CatalogCacheNotice } from '../marketplace/CatalogCacheNotice';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/MarketplacePage.tsx#L1-L845)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/McpDetailPage.tsx`**
- 源码声明的类型、组件或调用边界：`integrationTypeLabelKey`, `McpDetailPageProps`, `McpDetailPage`, `connector`, `runtimeName`, `detail`, `tools`, `skills`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { PublicationDetailStatus } from '../marketplace/PublicationDetailStatus';`；`import { openAssetPublish } from '../../features/assetPublishEvents';`；`import { canShowAssetPublish } from '../../features/assetPublishState';`；`import { useEffect, useState } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/McpDetailPage.tsx#L1-L548)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/MyMarketCard.tsx`**
- 源码声明的类型、组件或调用边界：`MyMarketCardProps`, `MyMarketCard`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { MarketCard } from './MarketCard';`；`import type { McpCardState } from './mcpState';`；`import type { McpBusyKind } from '../../types/connector';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/MyMarketCard.tsx#L1-L35)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/PickerModal.tsx`**
- 源码声明的类型、组件或调用边界：`PickerItem`, `PickerModalProps`, `PickerModal`, `visible`, `q`, `toggle`, `checked`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Search, Plus, Check } from 'lucide-react';`；`import { FormDrawer, PageCard } from '../ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/PickerModal.tsx#L1-L99)。
- **`jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/PluginDetailPage.tsx`**
- 源码声明的类型、组件或调用边界：`PluginDetailPageProps`, `PluginDetailPage`, `detail`, `loadDetail`, `storeBusy`, `installed`, `connectionState`, `installPending`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { PublicationDetailStatus } from '../marketplace/PublicationDetailStatus';`；`import { openAssetPublish } from '../../features/assetPublishEvents';`；`import { canShowAssetPublish } from '../../features/assetPublishState';`；`import { useEffect, useState } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/PluginDetailPage.tsx#L1-L422)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-connectormarket/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
