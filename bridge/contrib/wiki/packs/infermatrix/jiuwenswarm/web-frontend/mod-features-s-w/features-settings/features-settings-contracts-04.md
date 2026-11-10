---
name: features-settings-contracts-04
description: features-settings 源码接口 04：settings/modules 下 experimental（definition、externalCliInstallState）、general（GeneralSettings、definition）与 models 的前半部分（ContextWindowField、FreeModelSettingsDialog、FreeModelsSettings、ModelDialog、ModelNameField、ModelProviderSelect、ModelsSettings、OpenAIAccountField）的声明与导入依赖
metadata:
  scope: 只收 settings/modules 下 experimental、general 及 models 的 ContextWindowField 至 OpenAIAccountField 各文件的接口记录；models 的 contextWindow.ts 起及更后的文件归 features-settings-contracts-05
---
# features-settings 源码接口与集成边界 04

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/definition.ts`**
- 源码声明的类型、组件或调用边界：`experimentalModule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { settingsNavigationIcons } from '../../../../assets/settings';`；`import type { SettingsModuleDefinition } from '../../registry/types';`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/definition.ts#L1-L71)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/externalCliInstallState.ts`**
- 源码声明的类型、组件或调用边界：`ExternalCliPendingChoices`, `ExternalCliInstallStatuses`, `ExternalCliPendingChoiceStorage`, `EXTERNAL_CLI_PENDING_CHOICES_STORAGE_KEY`, `EXTERNAL_CLI_AGENT_KINDS`, `browserSessionStorage`, `normalizePendingChoice`, `candidate`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ExternalCliAgentKind, ExternalCliPendingChoice } from '../../../../components/External`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/externalCliInstallState.ts#L1-L99)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/general/GeneralSettings.tsx`**
- 源码声明的类型、组件或调用边界：`TagVariant`, `ConnectionStatusSetting`, `connectionKey`, `connectionVariant`, `CloseAction`, `isCloseAction`, `closeActionApi`, `api`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Select, Tag, type TagVariant } from '../../../../components/ui';`；`import { SettingRow } from '../../components';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/general/GeneralSettings.tsx#L1-L108)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/general/definition.ts`**
- 源码声明的类型、组件或调用边界：`generalModule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { settingsNavigationIcons } from '../../../../assets/settings';`；`import type { SettingsModuleDefinition } from '../../registry/types';`；`import { ConnectionStatusSetting } from './GeneralSettings';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/general/definition.ts#L1-L27)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ContextWindowField.tsx`**
- 源码声明的类型、组件或调用边界：`ContextWindowFieldProps`, `ContextWindowField`, `currentValue`, `currentTokens`, `selected`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Button, Input } from '../../../../components/ui';`；`import { CONTEXT_WINDOW_PRESETS, parseContextWindowTokens } from './contextWindow';`；`import './ContextWindowField.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ContextWindowField.tsx#L1-L67)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/FreeModelSettingsDialog.tsx`**
- 源码声明的类型、组件或调用边界：`FreeModelSettingsDialog`, `titleId`, `setAvailableModels`, `valueOf`, `hasInvalid`, `save`, `changes`, `model`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useId, useMemo, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { X } from 'lucide-react';`；`import { Button, Dialog } from '../../../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/FreeModelSettingsDialog.tsx#L1-L148)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/FreeModelsSettings.tsx`**
- 源码声明的类型、组件或调用边界：`QuotaView`, `PointsHeadline`, `status`, `value`, `unit`, `PointsHint`, `reset`, `hasUsage`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useMemo, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { ChevronRight, LogIn } from 'lucide-react';`；`import { Tag } from '../../../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/FreeModelsSettings.tsx#L1-L279)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelDialog.tsx`**
- 源码声明的类型、组件或调用边界：`FormItem`, `ModelDraft`, `ModelProtocol`, `ConnectionFailure`, `FETCH_REASON_KEYS`, `getPresetStatusKey`, `getModelFetchKey`, `ModelDialog`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import type { ModelEntry, VendorFetchModelsResult, VendorPreset, VendorPresetMap } from '../../../..`；`import { Button } from '../../../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelDialog.tsx#L1-L640)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelNameField.tsx`**
- 源码声明的类型、组件或调用边界：`ModelMenuPosition`, `ModelNameField`, `listboxId`, `rootRef`, `inputRef`, `menuRef`, `wasFetching`, `updateMenuPosition`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import { Check, ChevronDown, RefreshCw } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelNameField.tsx#L1-L308)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelProviderSelect.tsx`**
- 源码声明的类型、组件或调用边界：`ModelProtocol`, `ProviderOption`, `ProviderMenuPosition`, `getPresetApiAddress`, `GROUPS`, `VENDOR_TRANSLATION_KEYS`, `getVendorLabel`, `translationKey`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import { Check, ChevronDown, Search } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelProviderSelect.tsx#L1-L356)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelsSettings.tsx`**
- 源码声明的类型、组件或调用边界：`EMPTY_VENDOR_CATALOG`, `ModelConfirmation`, `ValidationToast`, `ReplaceModelsResult`, `SaveModelsOptions`, `modelIdentity`, `parseModelsPayload`, `models`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { Check, ChevronRight } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import type { ModelEntry, VendorPresetMap } from '../../../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/ModelsSettings.tsx#L1-L568)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/OpenAIAccountField.tsx`**
- 源码声明的类型、组件或调用边界：`SettingsRequest`, `LOGIN_POLL_MINIMUM_MS`, `AUTH_REQUEST_TIMEOUT_MS`, `MODEL_REQUEST_TIMEOUT_MS`, `LOGIN_START_TIMEOUT_MS`, `AuthStatus`, `LoginPayload`, `PendingLoginPayload`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { Copy, ExternalLink, KeyRound, LogOut } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import type { ModelEntry } from '../../../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/OpenAIAccountField.tsx#L1-L629)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-settings/source-contracts-04.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
