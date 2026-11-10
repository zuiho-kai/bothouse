---
name: features-contextusage-contracts-01
description: features-contextusage 源码接口 01：src/features/contextUsage 下 contextUsageCategories（上下文用量类别定义与键）与 contextUsageModel（快照字段的类型守卫函数）两个文件的声明与导入依赖
metadata:
  scope: 只收这两个文件的静态声明记录，不证明运行行为；目录入口归 features-contextusage-overview
---
# features-contextusage 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/contextUsage/contextUsageCategories.ts`**
- 源码声明的类型、组件或调用边界：`CONTEXT_USAGE_CATEGORY_DEFINITIONS`, `KnownContextUsageCategoryKey`, `CONTEXT_USAGE_CATEGORY_KEYS`, `getContextUsageCategoryDefinition`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/contextUsage/contextUsageCategories.ts#L1-L30)。
- **`jiuwenswarm/channels/web/frontend/src/features/contextUsage/contextUsageModel.ts`**
- 源码声明的类型、组件或调用边界：`isRecord`, `isNonNegativeNumber`, `isNullableNumber`, `isTokenCount`, `isNullableTokenCount`, `isNullableString`, `isOptionalContextRole`, `isSupportedContextUsagePhase`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { ContextUsagePart, ContextUsageSnapshot } from '../../types';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/contextUsage/contextUsageModel.ts#L1-L142)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-contextusage/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
