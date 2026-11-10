---
name: gateway-channels-scripts-contracts-01
description: gateway-channels scripts 源码接口与集成边界 01：jiuwenswarm/scripts/whatsapp-bridge.js 的词法声明（fs、path、pino、qrcodeTerminal、loadBaileys、makeWASocket 等）与 require 导入
metadata:
  scope: 只收 whatsapp-bridge.js 一个文件的声明与导入，不证明运行行为；入口说明归 gateway-channels-scripts-overview
---
# scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/scripts/whatsapp-bridge.js`**
- 源码声明的类型、组件或调用边界：`fs`, `path`, `pino`, `qrcodeTerminal`, `loadBaileys`, `makeWASocket`, `useMultiFileAuthState`, `DisconnectReason`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const fs = require("fs");`；`const path = require("path");`；`const { WebSocketServer } = require("ws");`；`const pino = require("pino");`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/scripts/whatsapp-bridge.js#L1-L281)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
