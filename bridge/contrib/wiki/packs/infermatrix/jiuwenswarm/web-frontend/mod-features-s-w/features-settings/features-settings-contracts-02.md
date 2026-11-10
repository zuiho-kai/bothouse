---
name: features-settings-contracts-02
description: features-settings 源码接口与集成边界 02：modules/archivedTasks 三个文件（ArchivedTasksSettings、definition、useArchivedTaskLists）、modules/browser/definition.ts，以及 modules/channels 的 ChannelsModule、SettingsChannelsPanel、channelAdapters、channelCatalog、channelFormItems、channelGuideUrls、channelRequirements、channelTypes、components/ChannelConfigDialog 共十三个文件的静态声明与导入
metadata:
  scope: 只收 archivedTasks、browser 模块和 channels 模块的面板、适配、目录、表单项、文档链接、必填规则、类型与 ChannelConfigDialog 声明，不证明运行行为；channels 其余组件、表单与 hook 以及 experimental 模块归 features-settings-contracts-03，设置页外壳与 agent 模块归 features-settings-contracts-01
---
# features-settings 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/archivedTasks/ArchivedTasksSettings.tsx`**
- 源码声明的类型、组件或调用边界：`ArchivedSession`, `SEARCH_DEBOUNCE_MS`, `DeleteTarget`, `actionErrorKey`, `code`, `ArchivedTasksSettingsModule`, `ArchivedTasksSettingsPanel`, `workMode`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Archive, CircleAlert, Folder, Loader2, RotateCcw, Search, Trash2 } from 'lucide-react';`；
  - `import { Button, Input, toast } from '../../../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/archivedTasks/ArchivedTasksSettings.tsx#L1-L431)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/archivedTasks/definition.ts`**
- 源码声明的类型、组件或调用边界：`archivedTasksModule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Archive } from 'lucide-react';`；`import type { SettingsModuleDefinition } from '../../registry/types';`；`import { ArchivedTasksSettingsModule } from './ArchivedTasksSettings';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/archivedTasks/definition.ts#L1-L17)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/archivedTasks/useArchivedTaskLists.ts`**
- 源码声明的类型、组件或调用边界：`ArchivedListParams`, `ArchivedListResponse`, `ArchivedSession`, `PAGE_SIZE`, `EVENT_REFRESH_DEBOUNCE_MS`, `ARCHIVE_EVENT_NAMES`, `ResourceListState`, `createInitialListState`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useRef, useState } from 'react';`；`import { webClient } from '../../../../services/webClient';`；`import {`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/archivedTasks/useArchivedTaskLists.ts#L1-L177)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/browser/definition.ts`**
- 源码声明的类型、组件或调用边界：`browserModule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { settingsNavigationIcons } from '../../../../assets/settings';`；`import type { SettingsModuleDefinition } from '../../registry/types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/browser/definition.ts#L1-L26)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/ChannelsModule.tsx`**
- 源码声明的类型、组件或调用边界：`ChannelsModule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { SettingsChannelsPanel } from './SettingsChannelsPanel';`；`import { useSettingsServices } from '../../services/SettingsServicesProvider';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/ChannelsModule.tsx#L1-L19)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/SettingsChannelsPanel.tsx`**
- 源码声明的类型、组件或调用边界：`SettingsChannelsPanelProps`, `SettingsChannelsPanel`, `controller`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import { Button } from '../../../../components/ui';`；`import { SettingsConfirmDialog } from '../../components';`；`import { ChannelConfigDialog } from './components/ChannelConfigDialog';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/SettingsChannelsPanel.tsx#L1-L97)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelAdapters.ts`**
- 源码声明的类型、组件或调用边界：`DEFAULT_FEISHU_CONFIG`, `DEFAULT_XIAOYI_CONFIG`, `normalizeStringList`, `normalizeTextList`, `normalizeFeishuConfig`, `data`, `normalizeFeishuApp`, `config`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import i18n from '../../../../i18n';`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelAdapters.ts#L1-L378)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelCatalog.ts`**
- 源码声明的类型、组件或调用边界：`SETTINGS_CHANNEL_IDS`, `CHANNEL_LOGOS`, `normalizeEnabledChannels`, `channelId`, `buildSettingsChannels`, `enabledChannels`, `getSettingsChannelLogo`, `getSettingsChannelLabel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TFunction } from 'i18next';`；`import { settingsChannelLogos } from '../../../../assets/settings';`；`import type { ChannelItem, SettingsChannelId } from './channelTypes';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelCatalog.ts#L1-L51)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelFormItems.ts`**
- 源码声明的类型、组件或调用边界：`passwordLabels`, `switchLabel`, `withFieldRequirements`, `createXiaoyiFormItems`, `createFeishuAppFormItems`, `createDingtalkFormItems`, `createTelegramFormItems`, `createDiscordFormItems`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { TFunction } from 'i18next';`；`import type { FormItem, FormValues } from '../../../../components/form';`；`import { isChannelFormFieldOptional } from './channelRequirements';`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelFormItems.ts#L1-L324)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelGuideUrls.ts`**
- 源码声明的类型、组件或调用边界：`ChannelGuideLanguage`, `CHANNEL_GUIDE_DOCS_VERSION`, `CHANNEL_GUIDE_BASE_URL`, `CHANNEL_GUIDE_PATHS`, `getSettingsChannelGuideUrl`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SettingsChannelId } from './channelTypes';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelGuideUrls.ts#L1-L31)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelRequirements.ts`**
- 源码声明的类型、组件或调用边界：`FieldRequirement`, `ChannelFormValuesById`, `ChannelFieldRequirements`, `CHANNEL_FIELD_REQUIREMENTS`, `satisfies`, `shouldConfirmXiaoyiEnable`, `getFieldRequirement`, `requirement`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { FormRule, FormRules, FormValues } from '../../../../components/form';`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelRequirements.ts#L1-L167)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelTypes.ts`**
- 源码声明的类型、组件或调用边界：`SettingsChannelId`, `SingleSettingsChannelId`, `ChannelItem`, `FeishuConfig`, `FeishuAppConfig`, `FeishuAppDraft`, `FeishuFormValues`, `XiaoyiConfig`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelTypes.ts#L1-L113)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/components/ChannelConfigDialog.tsx`**
- 源码声明的类型、组件或调用边界：`RefObject`, `FeishuChannelFormHandle`, `SettingsChannelControllers`, `ChannelFormContent`, `ChannelConfigDialog`, `feishuFormRef`, `controller`, `label`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useRef, type RefObject } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { FormDialog } from '../../../../../components/form';`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/components/ChannelConfigDialog.tsx#L1-L119)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-settings/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
