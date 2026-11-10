---
name: components-cronpanel-contracts-01
description: components-cronpanel 源码接口与集成边界 01：web/frontend/src/components/CronPanel 下 ConfirmDialog.tsx、CronTaskDrawer.tsx、DatePicker.tsx、ModeSelector.tsx、ScheduleEditor.tsx、SimpleSelect.tsx、StatusBadge.tsx、TemplateClusterIcon.tsx、TimePicker.tsx、constants.ts、cronExprValidation.ts、cronMode.ts、cronProjectDisplay.ts、cronWakeOffset.ts、cronWeekAlpha.ts 共 15 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 15 个前端文件的静态声明，不证明运行行为；其余前端文件的声明归 components-cronpanel-contracts-02；入口说明归 components-cronpanel-overview
---
# components-cronpanel 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/ConfirmDialog.tsx`**
- 源码声明的类型、组件或调用边界：`ConfirmDialogProps`, `ConfirmDialog`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import { X } from 'lucide-react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/ConfirmDialog.tsx#L1-L48)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/CronTaskDrawer.tsx`**
- 源码声明的类型、组件或调用边界：`CRON_EFFECTIVE_DATE_UI_ENABLED`, `CRON_NAME_MAX_LENGTH`, `CRON_DESCRIPTION_MAX_LENGTH`, `CronTaskFormValue`, `emptyForm`, `jobToForm`, `templateToForm`, `CronTaskDrawerProps`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useState, ReactNode } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { X, Pencil } from 'lucide-react';`；`import ScheduleEditor from './ScheduleEditor';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/CronTaskDrawer.tsx#L1-L522)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/DatePicker.tsx`**
- 源码声明的类型、组件或调用边界：`DatePickerProps`, `buildMonthList`, `list`, `offset`, `d`, `parseFlexibleDate`, `m`, `date`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';`；`import { useClickOutside } from './useClickOutside';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/DatePicker.tsx#L1-L261)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/ModeSelector.tsx`**
- 源码声明的类型、组件或调用边界：`ModeSelectorProps`, `ModeSelector`, `rootRef`, `menuPortalRef`, `handlePointerDown`, `updateMenuPosition`, `rect`, `currentMode`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useLayoutEffect, useRef, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import clsx from 'clsx';`；`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/ModeSelector.tsx#L1-L149)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/ScheduleEditor.tsx`**
- 源码声明的类型、组件或调用边界：`ScheduleEditorProps`, `TopMode`, `PERIOD_KINDS`, `WEEKDAY_ITEMS`, `WEEK_OF_MONTH_OPTIONS`, `topModeOf`, `defaultForTopMode`, `intervalNumberTextOf`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import SimpleSelect from './SimpleSelect';`；`import TimePicker from './TimePicker';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/ScheduleEditor.tsx#L1-L640)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/SimpleSelect.tsx`**
- 源码声明的类型、组件或调用边界：`SimpleSelectOption`, `SimpleSelectProps`, `SimpleSelect`, `rootRef`, `selected`, `isEmptySelection`, `selectedLabel`, `selectedTitle`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useRef, useState } from 'react';`；`import type { ReactNode } from 'react';`；`import { ChevronDown, Check } from 'lucide-react';`；`import { useClickOutside } from './useClickOutside';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/SimpleSelect.tsx#L1-L102)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/StatusBadge.tsx`**
- 源码声明的类型、组件或调用边界：`StatusBadgeProps`, `RunningIcon`, `BoldRingIcon`, `StatusBadge`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/StatusBadge.tsx#L1-L58)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/TemplateClusterIcon.tsx`**
- 源码声明的类型、组件或调用边界：`TemplateClusterIcon`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/TemplateClusterIcon.tsx#L1-L27)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/TimePicker.tsx`**
- 源码声明的类型、组件或调用边界：`HOURS`, `MINUTES`, `TimePickerProps`, `TimePicker`, `rootRef`, `pick`, `disabled`, `disabled`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { Clock } from 'lucide-react';`；`import { useClickOutside } from './useClickOutside';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/TimePicker.tsx#L1-L106)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/constants.ts`**
- 源码声明的类型、组件或调用边界：`TIMEZONE_OPTIONS`, `CRON_TEMPLATES`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { CronTemplateUI } from '../../types/cron';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/constants.ts#L1-L44)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronExprValidation.ts`**
- 源码声明的类型、组件或调用边界：`isValidCronField`, `parts`, `part`, `step`, `rangeValid`, `num`, `getFieldError`, `isValidCronRange`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { normalizeWeekAlphas } from './cronWeekAlpha.js';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronExprValidation.ts#L1-L115)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronMode.ts`**
- 源码声明的类型、组件或调用边界：`isTeamCronModeValue`, `value`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronMode.ts#L1-L19)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronProjectDisplay.ts`**
- 源码声明的类型、组件或调用边界：`CronProjectLike`, `isDefaultLikeProject`, `resolveCronJobProjectName`, `project`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronProjectDisplay.ts#L1-L31)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronWakeOffset.ts`**
- 源码声明的类型、组件或调用边界：`WAKE_OFFSET_MAX_MINUTES`, `normalizeWakeOffsetSeconds`, `n`, `wakeOffsetSecondsToMinutes`, `wakeOffsetMinutesToSeconds`, `minutes`, `clamped`, `normalizeWakeOffsetMinutesInput`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronWakeOffset.ts#L1-L37)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronWeekAlpha.ts`**
- 源码声明的类型、组件或调用边界：`WEEK_DOW_ALPHA_TO_NUM`, `WEEK_DOW_ALPHA_PATTERN`, `normalizeWeekAlphas`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronWeekAlpha.ts#L1-L24)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-cronpanel/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
