---
name: features-settings-contracts-03
description: features-settings 源码接口与集成边界 03：modules/channels 的 ChannelListSection、ChannelLogo、XiaoyiEnableConfirmDialog、definition、forms/ 四个表单（FeishuChannelForm、SimpleChannelForms、StandardChannelForm、XiaoyiChannelForm）、useChannelForm、useSettingsChannelsController，以及 modules/experimental 的 ExperimentalSettings、VideoDuplexModelSettings 共十二个文件的静态声明与导入
metadata:
  scope: 只收 channels 模块的列表组件、表单与控制 hook 以及 experimental 模块的文件声明，不证明运行行为；channels 的面板、适配与 ChannelConfigDialog 归 features-settings-contracts-02，入口说明归 features-settings-overview
---
# features-settings 源码接口与集成边界 03

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/components/ChannelListSection.tsx`**
- 源码声明的类型、组件或调用边界：`ChannelGuideLanguage`, `EnableIcon`, `DisableIcon`, `EditIcon`, `ChannelListSectionProps`, `ChannelListSection`, `guideLanguage`, `label`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Unlink } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import { settingsActionIcons } from '../../../../../assets/settings';`；`import { Button, Tag } from '../../../../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/components/ChannelListSection.tsx#L1-L220)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/components/ChannelLogo.tsx`**
- 源码声明的类型、组件或调用边界：`ChannelLogo`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { getSettingsChannelLogo } from '../channelCatalog';`；`import type { SettingsChannelId } from '../channelTypes';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/components/ChannelLogo.tsx#L1-L22)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/components/XiaoyiEnableConfirmDialog.tsx`**
- 源码声明的类型、组件或调用边界：`XiaoyiEnableConfirmDialog`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import { SettingsConfirmDialog } from '../../../components';`；`import type { useSettingsChannelsController } from '../useSettingsChannelsController';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/components/XiaoyiEnableConfirmDialog.tsx#L1-L27)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/definition.ts`**
- 源码声明的类型、组件或调用边界：`channelsModule`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { settingsNavigationIcons } from '../../../../assets/settings';`；`import type { SettingsModuleDefinition } from '../../registry/types';`；`import { ChannelsModule } from './ChannelsModule';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/definition.ts#L1-L16)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/forms/FeishuChannelForm.tsx`**
- 源码声明的类型、组件或调用边界：`FeishuChannelFormHandle`, `FeishuAppFormProps`, `FeishuAppForm`, `form`, `rules`, `items`, `FeishuChannelForm`, `FeishuChannelForm`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Form, useForm, useFormValue } from '../../../../../components/form';`；`import { createFeishuAppFormItems } from '../channelFormItems';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/forms/FeishuChannelForm.tsx#L1-L71)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/forms/SimpleChannelForms.tsx`**
- 源码声明的类型、组件或调用边界：`DingtalkChannelForm`, `items`, `rules`, `TelegramChannelForm`, `items`, `rules`, `DiscordChannelForm`, `items`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import {`；`import { createChannelFormRules } from '../channelRequirements';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/forms/SimpleChannelForms.tsx#L1-L58)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/forms/StandardChannelForm.tsx`**
- 源码声明的类型、组件或调用边界：`StandardChannelForm`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Form } from '../../../../../components/form';`；`import type { FormItem, FormRules, FormValues } from '../../../../../components/form';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/forms/StandardChannelForm.tsx#L1-L33)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/forms/XiaoyiChannelForm.tsx`**
- 源码声明的类型、组件或调用边界：`XiaoyiChannelForm`, `enabled`, `apiId`, `items`, `rules`, `showApiIdHint`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo, useState } from 'react';`；`import { X } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import { useFormValue } from '../../../../../components/form';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/forms/XiaoyiChannelForm.tsx#L1-L43)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/useChannelForm.ts`**
- 源码声明的类型、组件或调用边界：`ChannelFormOptions`, `ChannelFormController`, `useChannelForm`, `form`, `formState`, `load`, `payload`, `persistPayload`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useState } from 'react';`；`import { useForm, useFormState } from '../../../../components/form';`；`import type { FormStore } from '../../../../components/form/core/FormStore';`；`import type { FormValues } from '../../../../components/form/types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/useChannelForm.ts#L1-L136)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/useSettingsChannelsController.ts`**
- 源码声明的类型、组件或调用边界：`useSettingsChannelsController`, `loadChannels`, `payload`, `xiaoyi`, `feishu`, `dingtalk`, `telegram`, `discord`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { useFormValue } from '../../../../components/form';`；`import { deepEqual } from '../../../../components/form/core/FormStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/useSettingsChannelsController.ts#L1-L415)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/ExperimentalSettings.tsx`**
- 源码声明的类型、组件或调用边界：`ExternalCliAgentKind`, `ExternalCliConfigSaveResult`, `ExternalCliPendingChoice`, `CLI_DEFAULTS`, `NOTICE_AUTO_DISMISS_MS`, `externalCliReplayInFlight`, `ProactiveLimitsDialog`, `form`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useMemo, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { settingsActionIcons } from '../../../../assets/settings';`；`import { Button, Switch } from '../../../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/ExperimentalSettings.tsx#L1-L838)。
- **`jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/VideoDuplexModelSettings.tsx`**
- 源码声明的类型、组件或调用边界：`Provider`, `VoiceProtocol`, `ReplyLanguage`, `SettingsValues`, `DEFAULTS`, `SECRET_KEYS`, `Payload`, `secretPlaceholder`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { settingsActionIcons } from '../../../../assets/settings';`；`import { Button, Select } from '../../../../components/ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/settings/modules/experimental/VideoDuplexModelSettings.tsx#L1-L360)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-settings/source-contracts-03.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
