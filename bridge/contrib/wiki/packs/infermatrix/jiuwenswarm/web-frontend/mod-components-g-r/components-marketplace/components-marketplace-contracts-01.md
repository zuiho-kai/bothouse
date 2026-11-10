---
name: components-marketplace-contracts-01
description: components-marketplace 源码接口与集成边界 01：web/frontend/src/components/marketplace 下 CatalogCacheNotice.tsx、InstallationFilterSelect.tsx、MarketplaceSurface.tsx、PublicationDetailStatus.tsx 共 4 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 4 个前端文件的静态声明，不证明运行行为；入口说明归 components-marketplace-overview
---
# components-marketplace 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/marketplace/CatalogCacheNotice.tsx`**
- 源码声明的类型、组件或调用边界：`CatalogCacheMetadata`, `CatalogCacheNotice`, `notice`, `zh`, `text`, `updatedText`, `updatedTimestamp`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/marketplace/CatalogCacheNotice.tsx#L1-L37)。
- **`jiuwenswarm/channels/web/frontend/src/components/marketplace/InstallationFilterSelect.tsx`**
- 源码声明的类型、组件或调用边界：`InstallationFilter`, `matchesInstallation`, `InstallationFilterSelect`, `zh`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { FilterDropdown } from '../SkillPanel/SkillPanelWidgets';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/marketplace/InstallationFilterSelect.tsx#L1-L39)。
- **`jiuwenswarm/channels/web/frontend/src/components/marketplace/MarketplaceSurface.tsx`**
- 源码声明的类型、组件或调用边界：`MarketplaceSurfaceProps`, `MarketplaceSurface`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode, Ref } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/marketplace/MarketplaceSurface.tsx#L1-L23)。
- **`jiuwenswarm/channels/web/frontend/src/components/marketplace/PublicationDetailStatus.tsx`**
- 源码声明的类型、组件或调用边界：`PublicationDetailStatus`, `lookup`, `label`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import { useAssetPublication } from '../../hooks/useAssetPublication';`；`import { publicationDetailLabel } from '../../features/assetPublication';`；`import type { PublishAssetKind } from '../../types/assetPublish';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/marketplace/PublicationDetailStatus.tsx#L1-L10)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-marketplace/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
