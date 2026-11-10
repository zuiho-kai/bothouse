---
name: features-agentmanagement-contracts-01
description: features-agentmanagement 源码接口 01：src/features/agentManagement 下 adapter、groupClient、limits、locale、pendingInstallQueue、port、presentation、raw、selection、state、tagOptions、types、upload、viewModel 共十四个文件的声明与导入依赖
metadata:
  scope: 只收这十四个文件的静态声明记录，不证明运行行为；目录入口归 features-agentmanagement-overview
---
# features-agentmanagement 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/adapter.ts`**
- 源码声明的类型、组件或调用边界：`SupportedLocale`, `resolveLocalizedText`, `normalizeAgentSource`, `normalizeAgentGroupSource`, `normalizeAgentConnectionState`, `isPreviewableFile`, `lowerPath`, `normalizeCapability`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`；`import type {`；`import { normalizeEquipmentIdentity, normalizeEquipmentSource } from '../equipmentMarketplace';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/adapter.ts#L1-L272)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/groupClient.ts`**
- 源码声明的类型、组件或调用边界：`AgentGroupListOptions`, `AgentGroupManagementClient`, `readErrorCode`, `current`, `depth`, `record`, `rethrowGroupError`, `webError`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { webRequest } from '../../services/webClient';`；`import { withCatalogCache } from '../catalogCache';`；`import { getAgentManagementLocale } from './locale';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/groupClient.ts#L1-L140)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/limits.ts`**
- 源码声明的类型、组件或调用边界：`AGENT_NAME_MAX_LENGTH`, `AGENT_DESCRIPTION_MAX_LENGTH`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/limits.ts#L1-L2)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/locale.ts`**
- 源码声明的类型、组件或调用边界：`getAgentManagementLocale`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import i18n from '../../i18n';`；`import type { SupportedLocale } from './adapter';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/locale.ts#L1-L6)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/pendingInstallQueue.ts`**
- 源码声明的类型、组件或调用边界：`PendingInstallMode`, `PendingInstallJob`, `PendingInstallQueue`, `createPendingInstallQueue`, `enqueuePendingInstall`, `advancePendingInstallQueue`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/pendingInstallQueue.ts#L1-L33)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/port.ts`**
- 源码声明的类型、组件或调用边界：`AgentInstallResult`, `AgentManagementError`, `AgentInstallPendingError`, `AgentCatalogListOptions`, `SkillListOptions`, `AgentManagementClient`, `AgentGroupListOptions`, `AgentGroupManagementClient`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { CatalogCacheMetadata, CatalogItems } from '../catalogCache';`；`import type {`；`import { resolveAgentTagPayload } from './tagOptions';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/port.ts#L1-L205)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/presentation.ts`**
- 源码声明的类型、组件或调用边界：`getAgentAvatarUrl`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AgentCatalogItem } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/presentation.ts#L1-L5)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/raw.ts`**
- 源码声明的类型、组件或调用边界：`RawLocalizedText`, `RawAgentTemplateListItem`, `RawAgentCapability`, `RawAgentTag`, `RawAgentTemplateDetail`, `RawAgentGroupMember`, `RawAgentGroupCapabilities`, `RawAgentGroupListItem`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { CatalogCacheMetadata } from '../catalogCache';`；`import type { AgentConnectionState } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/raw.ts#L1-L170)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/selection.ts`**
- 源码声明的类型、组件或调用边界：`SelectionSourceTab`, `LOCAL_SKILL_SOURCES`, `TEAM_MARKET_PLUGIN_TYPES`, `isTeamSkillOption`, `isMineSkillOption`, `isMarketplaceSkillOption`, `isSkillVisibleInSourceTab`, `SortableSelection`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AgentCatalogItem, McpOption, RequestStatus, SkillOption } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/selection.ts#L1-L112)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/state.ts`**
- 源码声明的类型、组件或调用边界：`AgentManagementState`, `createInitialAgentManagementState`, `initialAgentManagementState`, `AgentManagementAction`, `agentManagementReducer`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/state.ts#L1-L151)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/tagOptions.ts`**
- 源码声明的类型、组件或调用边界：`AGENT_TAG_OPTIONS`, `resolveAgentTagPayload`, `labels`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/tagOptions.ts#L1-L19)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/types.ts`**
- 源码声明的类型、组件或调用边界：`AgentSource`, `AgentConnectionState`, `AgentManagementSource`, `RequestStatus`, `AgentCatalogItem`, `AgentCapability`, `AgentDetail`, `AgentGroupSource`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/types.ts#L1-L179)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/upload.ts`**
- 源码声明的类型、组件或调用边界：`AGENT_ARCHIVE_EXTENSIONS`, `AGENT_GROUP_ARCHIVE_EXTENSIONS`, `isAgentUploadFilename`, `lower`, `extractRpcErrorMessage`, `payload`, `apiError`, `mapLocalPackageImportError`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/upload.ts#L1-L51)。
- **`jiuwenswarm/channels/web/frontend/src/features/agentManagement/viewModel.ts`**
- 源码声明的类型、组件或调用边界：`CatalogScope`, `CatalogViewModel`, `GroupCatalogScope`, `GroupCatalogViewModel`, `CATEGORY_ALIASES`, `matchesCategory`, `aliases`, `GROUP_CATEGORY_ALIASES`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { AgentCatalogItem, AgentDetail, AgentGroupCatalogItem, AgentGroupDetail, DefinitionFile`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/viewModel.ts#L1-L187)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-agentmanagement/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
