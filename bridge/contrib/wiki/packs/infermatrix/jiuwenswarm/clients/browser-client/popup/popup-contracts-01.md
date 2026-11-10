---
name: popup-contracts-01
description: browser-client 前端源码接口与集成边界 01：popup/index.ts 与 popup.html（弹窗：连接状态点、会话名、固定页数、打开侧栏/设置）
metadata:
  scope: 只收 jiuwenswarm/channels/browser/frontend/src/popup 一个目录的静态声明记录：index.ts 导入 logger、constants、storage、i18n 的边界与 popup.html 的页面装配；该目录入口归 popup-overview
---
# popup 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/browser/frontend/src/popup/index.ts`**
- 源码声明的类型、组件或调用边界：`log`, `statusDot`, `statusText`, `sessionName`, `pinCount`, `openPanelBtn`, `openOptionsBtn`, `connected`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createLogger } from "@shared/logger";`；`import { MSG } from "@shared/constants";`；`import { getPinnedPagesBySession } from "@shared/storage";`；`import { initI18n, applyStaticI18n, t } from "@shared/i18n";`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/popup/index.ts#L1-L56)。
- **`jiuwenswarm/channels/browser/frontend/src/popup/popup.html`**
- 页面装配边界：body, script 标签；资源装载与宿主连接取决于对应属性和脚本实现。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/popup/popup.html#L1-L110)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/popup/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
