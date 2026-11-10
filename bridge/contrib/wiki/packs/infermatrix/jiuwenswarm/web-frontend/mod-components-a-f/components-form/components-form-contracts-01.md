---
name: components-form-contracts-01
description: components-form 源码接口与集成边界 01：web/frontend/src/components 下 form/components/Form.tsx、form/components/FormDialog.tsx、form/core/FormStore.ts、form/hooks/useForm.ts、form/hooks/useFormState.ts、form/types.ts 共 6 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 6 个前端文件的静态声明，不证明运行行为；入口说明归 components-form-overview
---
# components-form 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/form/components/Form.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `FormItemRenderer`, `controlId`, `field`, `finalDisabled`, `label`, `onChange`, `onBlur`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import {`；`import { HelpTips, Input, RadioGroup, Select, Switch, Textarea } from '../../ui';`；`import type { FormItem, FormRules, FormValues } from '../types';`；`import type { FormFieldOptions, FormStore } from '../core/FormStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/form/components/Form.tsx#L1-L218)。
- **`jiuwenswarm/channels/web/frontend/src/components/form/components/FormDialog.tsx`**
- 源码声明的类型、组件或调用边界：`ReactNode`, `FormDialog`, `titleId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { type ReactNode, useId } from 'react';`；`import { X } from 'lucide-react';`；`import { useTranslation } from 'react-i18next';`；`import { Button, Dialog, Loading } from '../../ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/form/components/FormDialog.tsx#L1-L122)。
- **`jiuwenswarm/channels/web/frontend/src/components/form/core/FormStore.ts`**
- 源码声明的类型、组件或调用边界：`Listener`, `FormFieldOptions`, `isPlainObject`, `prototype`, `assertFormValue`, `entry`, `deepEqual`, `leftKeys`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/form/core/FormStore.ts#L1-L224)。
- **`jiuwenswarm/channels/web/frontend/src/components/form/hooks/useForm.ts`**
- 源码声明的类型、组件或调用边界：`useForm`, `storeRef`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useRef } from 'react';`；`import { FormStore } from '../core/FormStore';`；`import type { FormValues } from '../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/form/hooks/useForm.ts#L1-L9)。
- **`jiuwenswarm/channels/web/frontend/src/components/form/hooks/useFormState.ts`**
- 源码声明的类型、组件或调用边界：`useFormState`, `useFormValue`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useSyncExternalStore } from 'react';`；`import type { FormStore } from '../core/FormStore';`；`import type { FormValues } from '../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/form/hooks/useFormState.ts#L1-L15)。
- **`jiuwenswarm/channels/web/frontend/src/components/form/types.ts`**
- 源码声明的类型、组件或调用边界：`FormValues`, `FormRuleTrigger`, `FormHookResult`, `FormRule`, `FormRules`, `FormBeforeValueChange`, `FormFieldRenderProps`, `FormItemBase`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ReactNode } from 'react';`；`import type { SelectOption, RadioOption } from '../ui';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/form/types.ts#L1-L87)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-form/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
