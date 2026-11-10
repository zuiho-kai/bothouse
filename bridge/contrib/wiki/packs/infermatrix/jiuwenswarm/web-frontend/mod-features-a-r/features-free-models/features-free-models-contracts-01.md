---
name: features-free-models-contracts-01
description: features-free-models 源码接口 01：src/features/free-models 下 campaign（useFreeModelsCampaign）、chatError（describeChatError 错误提示键）、points（积分额度格式化）、quotaReset（额度重置周期与时间解析）四个文件的声明与导入依赖
metadata:
  scope: 只收这四个文件的静态声明记录，不证明运行行为；目录入口归 features-free-models-overview
---
# features-free-models 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/free-models/campaign.ts`**
- 源码声明的类型、组件或调用边界：`FreeModelsCampaign`, `useFreeModelsCampaign`, `state`, `enabled`, `initialized`, `refresh`, `recheck`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useEffect } from 'react';`；`import type { CampaignState } from '../../services/authClient';`；`import { useAuthStore } from '../../stores/authStore';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/free-models/campaign.ts#L1-L34)。
- **`jiuwenswarm/channels/web/frontend/src/features/free-models/chatError.ts`**
- 源码声明的类型、组件或调用边界：`Translate`, `UPSTREAM_HINT_KEYS`, `LIFECYCLE_ERROR_KEYS`, `describeChatError`, `code`, `lifecycleKey`, `hintKey`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/free-models/chatError.ts#L1-L32)。
- **`jiuwenswarm/channels/web/frontend/src/features/free-models/points.ts`**
- 源码声明的类型、组件或调用边界：`PointsQuota`, `formatPoints`, `floored`, `usedRatio`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/free-models/points.ts#L1-L18)。
- **`jiuwenswarm/channels/web/frontend/src/features/free-models/quotaReset.ts`**
- 源码声明的类型、组件或调用边界：`QuotaResetText`, `Unit`, `parseResetPeriod`, `match`, `count`, `parseResetAt`, `date`, `formatTime`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/free-models/quotaReset.ts#L1-L78)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-free-models/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
