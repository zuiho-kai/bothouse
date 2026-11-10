---
name: channels-desktop-contracts-01
description: channels-desktop 源码接口与集成边界 01：channels/desktop/electron/browser_panels.cjs、channels/desktop/electron/launch.cjs、channels/desktop/electron/main.cjs、channels/desktop/electron/preload.cjs、channels/desktop/electron/target_mcp_wrapper.cjs 的逐文件静态声明记录与源码链接
metadata:
  scope: 只收上述文件的逐文件静态声明记录；入口说明与导航归 channels-desktop-overview
---
# channels-desktop 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/desktop/electron/browser_panels.cjs`**
- 源码声明的类型、组件或调用边界：`SHARED_BROWSER_PARTITION`, `panelIdentity`, `sid`, `member`, `panelId`, `processAlive`, `hasLiveLease`, `evictionCandidates`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const { createHash } = require('node:crypto');`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/electron/browser_panels.cjs#L1-L80)。
- **`jiuwenswarm/channels/desktop/electron/launch.cjs`**
- 源码声明的类型、组件或调用边界：`nodeNet`, `electronExecutable`, `env`, `child`, `reserveLoopbackPort`, `server`, `address`, `port`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const { spawn } = require('node:child_process');`；`const nodeNet = require('node:net');`；`const electronExecutable = require('electron');`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/electron/launch.cjs#L1-L83)。
- **`jiuwenswarm/channels/desktop/electron/main.cjs`**
- 源码声明的类型、组件或调用边界：`fs`, `fsSync`, `nodeHttp`, `nodeNet`, `os`, `path`, `BACKEND_HOST`, `FRONTEND_HOST`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, session, shell, Tray, WebContents`；`const { spawn, execFile } = require('node:child_process');`；`const { randomBytes, randomUUID } = require('node:crypto');`；`const { inspect } = require('node:util');`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/electron/main.cjs#L1-L2790)。
- **`jiuwenswarm/channels/desktop/electron/preload.cjs`**
- 源码声明的类型、组件或调用边界：`invoke`, `frontendOnly`, `desktopApi`, `listener`, `listener`, `listener`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const { contextBridge, ipcRenderer } = require('electron');`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/electron/preload.cjs#L1-L92)。
- **`jiuwenswarm/channels/desktop/electron/target_mcp_wrapper.cjs`**
- 源码声明的类型、组件或调用边界：`fs`, `os`, `path`, `readline`, `BLOCKED_TOOLS`, `resolveDiagnosticPath`, `configured`, `writeDiagnostic`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const fs = require('node:fs');`；`const os = require('node:os');`；`const path = require('node:path');`；`const readline = require('node:readline');`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/electron/target_mcp_wrapper.cjs#L1-L377)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/channels-desktop/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
