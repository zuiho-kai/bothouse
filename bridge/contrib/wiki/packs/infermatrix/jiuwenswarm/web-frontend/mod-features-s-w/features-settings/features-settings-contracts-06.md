---
name: features-settings-contracts-06
description: features-settings 源码接口 06：settings/services 的 SettingsSaveQueue、SettingsServicesProvider、SettingsSourceProvider、SettingsUnsavedChangesRegistry、createSettingsRequestRouter、settingsContract、settingsSourceContract、useSettingsConfig、useSettingsFormDialogClose、useUnsavedChanges 与 settings/settingsNavigation.ts 的声明与导入依赖
metadata:
  scope: 只收 settings/services 各文件与 settings/settingsNavigation.ts 的接口记录；modules 与 registry 各文件归 features-settings-contracts-05
---
# features-settings 源码接口与集成边界 06

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsSaveQueue.ts`**
- 源码声明的类型、组件或调用边界：`SettingsSaveStatus`, `SettingsSaveErrorScope`, `SettingsSaveOptions`, `Listener`, `SAVE_SUCCESS_VISIBLE_MS`, `SettingsSaveQueue`, `result`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsSaveQueue.ts#L1-L66)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsServicesProvider.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `SettingsServices`, `SettingsServicesContext`, `SettingsServicesProvider`, `saveQueueRef`, `changesRef`, `value`, `useSettingsServices`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';`；`import type { WebConnectionState } from '../../../types';`；`import type { SettingsRequest } from './settingsContract';`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsServicesProvider.tsx#L1-L83)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsSourceProvider.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `SettingsSourceController`, `SettingsSourceContext`, `useSettingsSource`, `value`, `addSavingKeys`, `removeSavingKeys`, `next`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNod`；`import { useTranslation } from 'react-i18next';`；`import { Loading } from '../../../components/ui';`；`import type { SettingValue, SettingsSource } from '../registry/types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsSourceProvider.tsx#L1-L232)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsUnsavedChangesRegistry.ts`**
- 源码声明的类型、组件或调用边界：`Listener`, `SettingsUnsavedChangesRegistry`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsUnsavedChangesRegistry.ts#L1-L22)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/services/createSettingsRequestRouter.ts`**
- 源码声明的类型、组件或调用边界：`SettingsRequestRoute`, `createSettingsRequestRouter`, `requestsByMethod`, `routeIds`, `route`, `method`, `request`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SettingsRequest } from './settingsContract';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/services/createSettingsRequestRouter.ts#L1-L29)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/services/settingsContract.ts`**
- 源码声明的类型、组件或调用边界：`SettingsCategory`, `SettingsRequest`, `ConfigValueKind`, `PermissionLevel`, `PermissionsMode`, `ConfigFieldContract`, `ModelValidationPayload`, `envField`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ModelEntry } from '../../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/services/settingsContract.ts#L1-L313)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/services/settingsSourceContract.ts`**
- 源码声明的类型、组件或调用边界：`SimpleSettingComponent`, `BROWSER_SETTING_COMPONENTS`, `LOCALE_SETTING_COMPONENTS`, `isSettingsSource`, `isSettingsSourceKey`, `isSettingsSourceComponent`, `field`, `serializeConfigSettingValue`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SettingValue, SettingsSource } from '../registry/types';`；`import { SETTINGS_CONFIG_FIELD_BY_KEY } from './settingsContract';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/services/settingsSourceContract.ts#L1-L39)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/services/useSettingsConfig.ts`**
- 源码声明的类型、组件或调用边界：`useSettingsConfig`, `requestId`, `reload`, `id`, `next`, `save`, `payload`, `result`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useRef, useState } from 'react';`；`import { buildConfigSavePayload } from './settingsContract';`；`import { useSettingsServices } from './SettingsServicesProvider';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/services/useSettingsConfig.ts#L1-L46)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/services/useSettingsFormDialogClose.ts`**
- 源码声明的类型、组件或调用边界：`SettingsFormDialogCloseOptions`, `SettingsFormDialogClose`, `useSettingsFormDialogClose`, `requestClose`, `cancelDiscard`, `confirmDiscard`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState } from 'react';`；`import { useFormState } from '../../../components/form';`；`import type { FormStore } from '../../../components/form/core/FormStore';`；`import type { FormValues } from '../../../components/form/types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/services/useSettingsFormDialogClose.ts#L1-L51)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/services/useUnsavedChanges.ts`**
- 源码声明的类型、组件或调用边界：`useUnsavedChanges`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect } from 'react';`；`import { useSettingsServices } from './SettingsServicesProvider';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/services/useUnsavedChanges.ts#L1-L10)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/settingsNavigation.ts`**
- 源码声明的类型、组件或调用边界：`SettingsModuleTarget`, `SETTINGS_MODULE_NAVIGATION_EVENT`, `requestSettingsModule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/settingsNavigation.ts#L1-L11)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-settings/source-contracts-06.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
