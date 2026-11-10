---
name: features-taskfullduplex-contracts-01
description: features-taskfullduplex 源码接口 01：features/taskFullDuplex/featureFlag.ts 的 setTaskFullDuplexEnabled、useTaskFullDuplexEnabled 等声明与 useSyncExternalStore 导入
metadata:
  scope: 只收 taskFullDuplex/featureFlag.ts 一个文件的接口记录；目录入口归 features-taskfullduplex-overview
---
# features-taskfullduplex 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/taskFullDuplex/featureFlag.ts`**
- 源码声明的类型、组件或调用边界：`enabled`, `listeners`, `setTaskFullDuplexEnabled`, `useTaskFullDuplexEnabled`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useSyncExternalStore } from 'react';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/taskFullDuplex/featureFlag.ts#L1-L21)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-taskfullduplex/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
