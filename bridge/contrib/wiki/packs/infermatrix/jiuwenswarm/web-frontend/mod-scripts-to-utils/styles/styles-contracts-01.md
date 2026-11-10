---
name: styles-contracts-01
description: web-frontend styles 源码接口与集成边界 01：src/styles/breakpoints.ts 的静态声明（breakpoints、BreakpointKey 与侧栏、聊天区、工具面板、分隔条、图标栏的宽度常量）
metadata:
  scope: 只收 breakpoints.ts 一个文件的静态声明索引，不证明运行行为；入口说明归 styles-overview
---
# styles 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/styles/breakpoints.ts`**
- 源码声明的类型、组件或调用边界：`breakpoints`, `BreakpointKey`, `SIDEBAR_WIDTH`, `SIDEBAR_WIDTH_WIDE`, `CHAT_MIN_WIDTH`, `TOOL_PANEL_MIN_WIDTH`, `DIVIDER_WIDTH`, `ICON_RAIL_WIDTH`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/styles/breakpoints.ts#L1-L43)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/styles/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
