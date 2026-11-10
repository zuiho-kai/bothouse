---
name: components-heartbeatpanel-contracts-01
description: components-heartbeatpanel 源码接口与集成边界 01：web/frontend/src/components/HeartbeatPanel 下 HeartbeatPagination.tsx、HeartbeatScheduleEditor.tsx、HeartbeatStatusBadge.tsx、HeartbeatTaskDrawer.tsx、heartbeatCronValidation.ts、heartbeatScheduleConvert.ts、heartbeatStatusText.ts、index.tsx 共 8 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 8 个前端文件的静态声明，不证明运行行为；入口说明归 components-heartbeatpanel-overview
---
# components-heartbeatpanel 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatPagination.tsx`**
- 源码声明的类型、组件或调用边界：`HEARTBEAT_PAGE_SIZE_OPTIONS`, `HEARTBEAT_PAGE_SIZE_DEFAULT`, `HeartbeatPaginationProps`, `HeartbeatPagination`, `pageSizeOptions`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useMemo } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import { ChevronLeft, ChevronRight } from 'lucide-react';`；`import SimpleSelect from '../CronPanel/SimpleSelect';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatPagination.tsx#L1-L79)。
- **`jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatScheduleEditor.tsx`**
- 源码声明的类型、组件或调用边界：`HeartbeatScheduleEditorProps`, `KIND_TABS`, `TIMEZONE_SELECT_OPTIONS`, `HeartbeatScheduleEditor`, `minIntervalMinutes`, `intervalMinutes`, `cronError`, `nowStr`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import type { HeartbeatScheduleFormValue } from './heartbeatScheduleConvert';`；`import type { HeartbeatScheduleKind } from '../../types/heartbeat';`；`import { validateHeartbeatCronExpr } from './heartbeatCronValidation';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatScheduleEditor.tsx#L1-L128)。
- **`jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatStatusBadge.tsx`**
- 源码声明的类型、组件或调用边界：`HeartbeatStatusVariant`, `VARIANT_CLASS`, `HeartbeatStatusBadge`, `variant`, `Icon`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useTranslation } from 'react-i18next';`；`import type { HeartbeatJobStatus } from '../../types/heartbeat';`；`import { heartbeatStatusVariant, heartbeatStatusLabelKey, type HeartbeatStatusVariant } from './hear`；
  - `import { RunningIcon, BoldRingIcon } from '../CronPanel/StatusBadge';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatStatusBadge.tsx#L1-L24)。
- **`jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatTaskDrawer.tsx`**
- 源码声明的类型、组件或调用边界：`HeartbeatScheduleFormValue`, `NAME_MAX_LENGTH`, `PROMPT_MAX_LENGTH`, `HeartbeatTaskFormValue`, `emptyHeartbeatTaskForm`, `jobToHeartbeatTaskForm`, `HeartbeatTaskDrawerProps`, `HeartbeatTaskDrawer`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import type { HeartbeatConcurrencyPolicy, HeartbeatMeta, HeartbeatSessionDeletedPolicy, HeartbeatTas`；`import {`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/HeartbeatTaskDrawer.tsx#L1-L225)。
- **`jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/heartbeatCronValidation.ts`**
- 源码声明的类型、组件或调用边界：`validateHeartbeatCronExpr`, `trimmed`, `parts`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { validateCronExpr } from '../CronPanel/cronExprValidation.js';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/heartbeatCronValidation.ts#L1-L17)。
- **`jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/heartbeatScheduleConvert.ts`**
- 源码声明的类型、组件或调用边界：`HeartbeatScheduleFormValue`, `MIN_INTERVAL_SECONDS`, `emptyHeartbeatScheduleForm`, `epochSecondsToOnceLocal`, `d`, `pad`, `date`, `time`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { HeartbeatScheduleDTO, HeartbeatScheduleKind } from '../../types/heartbeat';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/heartbeatScheduleConvert.ts#L1-L80)。
- **`jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/heartbeatStatusText.ts`**
- 源码声明的类型、组件或调用边界：`HeartbeatStatusVariant`, `heartbeatStatusVariant`, `heartbeatStatusLabelKey`, `canHeartbeatRunNow`, `canHeartbeatToggleEnable`, `hasRemainingRuns`, `KNOWN_RUN_NOW_REJECT_REASONS`, `heartbeatRunNowMessageKey`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { HeartbeatJobStatus, HeartbeatRunStatus, HeartbeatScheduleDTO } from '../../types/heart`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/heartbeatStatusText.ts#L1-L93)。
- **`jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/index.tsx`**
- 源码声明的类型、组件或调用边界：`HeartbeatTaskFormValue`, `HeartbeatPanelProps`, `heartbeatJobToUI`, `formatHeartbeatTimestamp`, `d`, `HeartbeatPanel`, `sessionIdRef`, `loadAll`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`；`import { useTranslation } from 'react-i18next';`；`import {`；`import { webRequest } from '../../services/webClient';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/HeartbeatPanel/index.tsx#L1-L664)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-heartbeatpanel/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
