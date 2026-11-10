---
name: components-cronpanel-contracts-02
description: components-cronpanel 源码接口与集成边界 02：web/frontend/src/components/CronPanel 下 index.tsx、scheduleConvert.ts、useClickOutside.ts、xiaoyiCronTarget.ts 共 4 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 4 个前端文件的静态声明，不证明运行行为；其余前端文件的声明归 components-cronpanel-contracts-01；入口说明归 components-cronpanel-overview
---
# components-cronpanel 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/index.tsx`**
- 源码声明的类型、组件或调用边界：`CronTaskFormValue`, `PAGE_SIZE_OPTIONS`, `DEFAULT_PAGE_SIZE`, `buildPageList`, `pages`, `start`, `end`, `p`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';`；`import { createPortal } from 'react-dom';`；`import { useTranslation } from 'react-i18next';`；
  - `import { ChevronDown, ChevronLeft, ChevronRight, TrendingUp, Newspaper, Briefcase } from 'lucide-rea`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/index.tsx#L1-L1864)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/scheduleConvert.ts`**
- 源码声明的类型、组件或调用边界：`pad2`, `parseTime`, `match`, `h`, `m`, `isWildcard`, `parseSingleInt`, `parseIntList`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { CronSchedule } from '../../types/cron';`；`import { normalizeWeekAlphas } from './cronWeekAlpha';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/scheduleConvert.ts#L1-L307)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/useClickOutside.ts`**
- 源码声明的类型、组件或调用边界：`RefObject`, `useClickOutside`, `handlePointerDown`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, type RefObject } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/useClickOutside.ts#L1-L14)。
- **`jiuwenswarm/channels/web/frontend/src/components/CronPanel/xiaoyiCronTarget.ts`**
- 源码声明的类型、组件或调用边界：`hasXiaoyiPushApiId`, `conf`, `apps`, `item`, `isCronTargetOptionDisabled`, `enabled`, `id`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/CronPanel/xiaoyiCronTarget.ts#L1-L54)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-cronpanel/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
