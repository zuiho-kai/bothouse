---
name: features-settings-contracts-01
description: features-settings 源码接口与集成边界 01：features/settings 下 SettingsPage、SettingsPageLayout、components/ 四个组件（SettingItemRenderer、SettingRow、SettingsConfirmDialog、SettingsSection）与 modules/agent 七个文件（AgentSettings、GenerationModelConfigDialog、MediaModelConfigDialog、definition、generationModels、mediaCapabilities、mediaModelConfig）共十三个文件的静态声明与导入
metadata:
  scope: 只收设置页外壳、通用设置组件与 agent 模块的文件声明，不证明运行行为；archivedTasks、browser 与 channels 模块前半归 features-settings-contracts-02，入口说明归 features-settings-overview
---
# features-settings 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/SettingsPage.tsx`**
- 源码声明的类型、组件或调用边界：`SettingsPage`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { WebConnectionState } from '../../types';`；`import type { SettingsRequest } from './services/settingsContract';`；`import type {`；`import type { ExternalCliInstallStatuses } from '../../components/ExternalCliInstallDialog';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/SettingsPage.tsx#L1-L79)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/SettingsPageLayout.tsx`**
- 源码声明的类型、组件或调用边界：`visibleItems`, `moduleAccess`, `sections`, `sectionAccess`, `items`, `SettingsItem`, `readOnly`, `readOnlyReason`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';`；`import { Check, CircleAlert } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import { Loading } from '../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/SettingsPageLayout.tsx#L1-L207)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingItemRenderer.tsx`**
- 源码声明的类型、组件或调用边界：`EditingChange`, `settingFieldKey`, `InlineSettingInput`, `source`, `value`, `saving`, `hasChanges`, `cancel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Button, Input, Select, Switch } from '../../../components/ui';`；`import type { SettingItemDefinition } from '../registry/types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingItemRenderer.tsx#L1-L203)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingRow.tsx`**
- 源码声明的类型、组件或调用边界：`SettingRow`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import './SettingRow.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingRow.tsx#L1-L38)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingsConfirmDialog.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `ButtonProps`, `SettingsConfirmDialogProps`, `SettingsConfirmDialog`, `titleId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useId, type ReactNode } from 'react';`；`import { X } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import { Button, Dialog, type ButtonProps } from '../../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingsConfirmDialog.tsx#L1-L72)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingsSection.tsx`**
- 源码声明的类型、组件或调用边界：`SettingsSection`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import './SettingsSection.css';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingsSection.tsx#L1-L33)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/AgentSettings.tsx`**
- 源码声明的类型、组件或调用边界：`FormItem`, `FormRules`, `MediaCapabilityModality`, `keyFields`, `modalities`, `videoGenFields`, `videoGenContextWindowField`, `visualGenFields`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { settingsActionIcons } from '../../../../assets/settings';`；`import { Button, Switch } from '../../../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/AgentSettings.tsx#L1-L618)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/GenerationModelConfigDialog.tsx`**
- 源码声明的类型、组件或调用边界：`FormItem`, `GenerationSlot`, `EMPTY_VENDOR_CATALOG`, `OPENAI_PROTOCOL`, `SaveConfig`, `GenerationDraft`, `readConfig`, `trimSlash`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import type { VendorPreset, VendorPresetMap } from '../../../../types';`；`import { Button } from '../../../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/GenerationModelConfigDialog.tsx#L1-L462)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/MediaModelConfigDialog.tsx`**
- 源码声明的类型、组件或调用边界：`FormItem`, `MediaModelDraft`, `EMPTY_VENDOR_CATALOG`, `FETCH_REASON_KEYS`, `SaveConfig`, `getPresetStatusKey`, `getModelFetchKey`, `validateMediaModelDraft`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import type { VendorFetchModelsResult, VendorPreset, VendorPresetMap } from '../../../../types';`；`import { Button } from '../../../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/MediaModelConfigDialog.tsx#L1-L517)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/definition.ts`**
- 源码声明的类型、组件或调用边界：`agentModule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { settingsNavigationIcons } from '../../../../assets/settings';`；`import type { SettingsModuleDefinition } from '../../registry/types';`；`import { AgentMediaSettings, AgentSearchSettings, VideoGenSettings, VisualGenSettings } from './Agen`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/definition.ts#L1-L43)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/generationModels.ts`**
- 源码声明的类型、组件或调用边界：`GenerationSlot`, `GenerationModel`, `MINIMAX_PROTOCOL`, `MODELARK_PROTOCOL`, `OPENROUTER_MODELS`, `MINIMAX_MODELS`, `MODELARK_MODELS`, `openRouterModelProtocol`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/generationModels.ts#L1-L211)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/mediaCapabilities.ts`**
- 源码声明的类型、组件或调用边界：`mediaCapabilityModalities`, `MediaCapabilityModality`, `mediaCapabilityConfigSuffixes`, `mediaCapabilityProviderMetadataSuffixes`, `mediaCapabilityConfigFields`, `mediaCapabilityProviderMetadataFields`, `mediaCapabilityContextWindowField`, `mediaCapabilityPersistenceFields`；
  - 这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/mediaCapabilities.ts#L1-L47)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/mediaModelConfig.ts`**
- 源码声明的类型、组件或调用边界：`ModelInputMode`, `MediaCapabilityModality`, `MODEL_PLANS`, `MediaModelDraft`, `isModelPlan`, `readConfig`, `createMediaModelDraft`, `apiBase`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ModelPlan, VendorPresetMap } from '../../../../types';`；`import { normalizeContextWindowTokens, resolveDraftContextWindowTokens } from '../models/contextWind`；`import {`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/agent/mediaModelConfig.ts#L1-L92)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-settings/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
