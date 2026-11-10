---
name: vscode-extension-contracts-01
description: VS Code 扩展构建脚本源码接口与集成边界 01：vscode-extension/esbuild.js 的声明（watch、SHARED_ASSETS、copyWebviewAssets 等）
metadata:
  scope: 只收 vscode-extension 目录下 esbuild.js 一个文件的静态声明；src 下 TypeScript 归 vscode-extension-src-contracts-01
---
# vscode-extension 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/ide/packages/vscode-extension/esbuild.js`**
- 源码声明的类型、组件或调用边界：`esbuild`, `fs`, `path`, `watch`, `sharedWebviewDir`, `resourcesDir`, `SHARED_ASSETS`, `copyWebviewAssets`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const esbuild = require('esbuild');`；`const fs = require('fs');`；`const path = require('path');`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/esbuild.js#L1-L62)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/vscode-extension/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
