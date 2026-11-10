---
name: options-contracts-01
description: browser-client 前端源码接口与集成边界 01：options/index.ts 与 options.html（设置页：host、port、自动提取/总结开关与保存）
metadata:
  scope: 只收 jiuwenswarm/channels/browser/frontend/src/options 一个目录的静态声明记录：index.ts 导入 @shared/storage、logger、i18n 的边界与 options.html 的页面装配；该目录入口归 options-overview
---
# options 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/browser/frontend/src/options/index.ts`**
- 源码声明的类型、组件或调用边界：`log`, `hostInput`, `portInput`, `autoExtractCheck`, `autoSummarizeCheck`, `saveBtn`, `statusMsg`, `load`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { loadSettings, saveSettings } from "@shared/storage";`；`import { createLogger } from "@shared/logger";`；`import { initI18n, applyStaticI18n, t } from "@shared/i18n";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/options/index.ts#L1-L48)。
- **`jiuwenswarm/channels/browser/frontend/src/options/options.html`**
- 页面装配边界：body, script 标签；资源装载与宿主连接取决于对应属性和脚本实现。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/options/options.html#L1-L120)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/options/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
