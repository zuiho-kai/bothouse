---
name: shared-webview-contracts-01
description: shared-webview 源码接口与集成边界 01：swarm_map.html 的常量与状态声明（IDLE_WARN_MS、FEED_MAX、LANE_COLOURS 等）及页面装配边界
metadata:
  scope: 只收 shared-webview/swarm_map.html 一个文件的静态声明；该目录入口归 shared-webview-overview
---
# shared-webview 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/ide/packages/shared-webview/swarm_map.html`**
- 源码声明的类型、组件或调用边界：`IDLE_WARN_MS`, `FEED_MAX`, `LANE_COLOURS`, `_laneColourMap`, `ORCHESTRATOR_NAME`, `_state`, `_msgOpen`, `_debugOpen`；这是词法声明索引，不把局部变量当成对外导出 API。
- 页面装配边界：body, script 标签；资源装载与宿主连接取决于对应属性和脚本实现。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/swarm_map.html#L1-L1693)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/shared-webview/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
