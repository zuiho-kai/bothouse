---
name: features-settings-contracts-05
description: features-settings 源码接口 05：settings/modules/models 的 contextWindow、definition、modelAdapters、modelListOperations、modelReasoning、modelValidation，personalContext 模块，以及 settings/registry 的 accessPolicy、buildSettingsPageDefinition、createSettingsPageDefinition、openSourceDefinition、types 的声明与导入依赖
metadata:
  scope: 只收 settings/modules/models 的 contextWindow.ts 至 modelValidation.ts、personalContext 模块与 settings/registry 各文件的接口记录；modules 下 experimental、general 及 models 的组件文件归 features-settings-contracts-04，settings/services 与 settingsNavigation.ts 归 features-settings-contracts-06
---
# features-settings 源码接口与集成边界 05

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/contextWindow.ts`**
- 源码声明的类型、组件或调用边界：`DEFAULT_CONTEXT_WINDOW_TOKENS`, `ONE_MILLION_CONTEXT_WINDOW_TOKENS`, `CONTEXT_WINDOW_PRESETS`, `MAX_CONTEXT_WINDOW_TOKENS`, `CONTEXT_WINDOW_PATTERN`, `CONTEXT_WINDOW_UNIT_MULTIPLIERS`, `parseContextWindowNumber`, `parseContextWindowTokens`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/contextWindow.ts#L1-L64)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/definition.ts`**
- 源码声明的类型、组件或调用边界：`modelsModule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { settingsNavigationIcons } from '../../../../assets/settings';`；`import type { SettingsModuleDefinition } from '../../registry/types';`；`import { FreeModelsSettings } from './FreeModelsSettings';`；`import { ModelsSettings } from './ModelsSettings';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/definition.ts#L1-L23)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelAdapters.ts`**
- 源码声明的类型、组件或调用边界：`ModelProtocol`, `ModelInputMode`, `CUSTOM_VENDOR_SELECTION`, `OPENAI_ACCOUNT_SELECTION`, `OPENAI_ACCOUNT_DEFAULT_API_BASE`, `ModelDraft`, `MODEL_DRAFT_FIELDS`, `rebaseModelDraft`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ModelEntry, ModelPlan, VendorPreset, VendorPresetMap } from '../../../../types';`；`import {`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelAdapters.ts#L1-L316)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelListOperations.ts`**
- 源码声明的类型、组件或调用边界：`LOGIN_MODEL_SOURCE`, `ModelDisplayItem`, `ModelDisplayGroup`, `isRuntimeGrantedModel`, `getEditableModels`, `getModelDisplayGroups`, `editableGroups`, `items`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ModelEntry } from '../../../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelListOperations.ts#L1-L85)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelReasoning.ts`**
- 源码声明的类型、组件或调用边界：`record`, `parseReasoningCapability`, `parseProtocols`, `protocols`, `parseRequiredProtocols`, `protocols`, `parseReasoningCapabilities`, `parseReasoningRules`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelReasoning.ts#L1-L126)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelValidation.ts`**
- 源码声明的类型、组件或调用边界：`ModelDraft`, `ModelDraftErrors`, `MAX_API_KEY_LENGTH`, `validateModelDraft`, `errors`, `alias`, `modelName`, `apiBase`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ModelEntry, VendorPresetMap } from '../../../../types';`；`import { parseContextWindowTokens } from './contextWindow';`；`import { CUSTOM_VENDOR_SELECTION, OPENAI_ACCOUNT_SELECTION, findVendorPreset, type ModelDraft } from`；
  - `import { isReasoningLevelSupported, resolveModelReasoning } from './modelReasoning';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/modelValidation.ts#L1-L81)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/personalContext/PersonalContextSettingsModule.tsx`**
- 源码声明的类型、组件或调用边界：`PersonalContextSettingsModule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useSettingsServices } from '../../services/SettingsServicesProvider';`；`import { FEATURE_PERSONAL_CONTEXT_UI } from '../../../../featureFlags';`；`import { PersonalContextSettingsPanel } from '../../../../components/PersonalContext/SettingsPanel';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/personalContext/PersonalContextSettingsModule.tsx#L1-L16)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/personalContext/definition.ts`**
- 源码声明的类型、组件或调用边界：`personalContextSettingsModule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { settingsNavigationIcons } from '../../../../assets/settings';`；`import type { SettingsModuleDefinition } from '../../registry/types';`；`import { PersonalContextSettingsModule } from './PersonalContextSettingsModule';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/personalContext/definition.ts#L1-L20)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/registry/accessPolicy.ts`**
- 源码声明的类型、组件或调用边界：`openSourceSettingsAccessPolicy`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { SettingsAccessPolicy } from './types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/registry/accessPolicy.ts#L1-L10)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/registry/buildSettingsPageDefinition.ts`**
- 源码声明的类型、组件或调用边界：`ACCESS_LEVEL_RANK`, `assertNonEmpty`, `accessNodeKey`, `assertTargetExists`, `module`, `section`, `addModule`, `effectiveAnchorId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createSettingsPageDefinition } from './createSettingsPageDefinition';`；`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/registry/buildSettingsPageDefinition.ts#L1-L207)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/registry/createSettingsPageDefinition.ts`**
- 源码声明的类型、组件或调用边界：`assertId`, `assertUnique`, `seen`, `id`, `settingItemI18nKey`, `flattenItems`, `validateItem`, `component`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { isSettingsSource, isSettingsSourceComponent, isSettingsSourceKey } from '../services/settin`；`import type { SettingItemDefinition, SettingsModuleDefinition, SettingsPageDefinition } from './type`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/registry/createSettingsPageDefinition.ts#L1-L128)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/registry/openSourceDefinition.ts`**
- 源码声明的类型、组件或调用边界：`openSourceSettingsPageDefinition`, `settingsPageDefinition`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createSettingsPageDefinition } from './createSettingsPageDefinition';`；`import { openSourceSettingsAccessPolicy } from './accessPolicy';`；`import { generalModule } from '../modules/general';`；`import { modelsModule } from '../modules/models';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/registry/openSourceDefinition.ts#L1-L28)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/registry/types.ts`**
- 源码声明的类型、组件或调用边界：`I18nKey`, `SettingsModuleId`, `SettingsAccessLevel`, `SettingsCompositionMode`, `SettingsSource`, `SettingValue`, `SettingsAccessNode`, `SettingsAccessContext`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ComponentType, ElementType } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/registry/types.ts#L1-L101)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-settings/source-contracts-05.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
