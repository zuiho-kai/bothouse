---
name: browser-client-contracts-01
description: browser-client 源码接口与集成边界 01：vite.config.ts、vite.content.config.ts
metadata:
  scope: 只收 channels/browser/frontend 下 vite.config.ts 至 vite.content.config.ts 共 2 个源码文件的静态声明（接口、类型、依赖与源码依据链接）
---
# browser-client 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/browser/frontend/vite.config.ts`**
- 集成边界的导入/加载声明：`import { defineConfig } from "vite"`；`import { resolve } from "path"`；`import { cpSync, mkdirSync } from "fs"`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/vite.config.ts#L1-L54)。
- **`jiuwenswarm/channels/browser/frontend/vite.content.config.ts`**
- 集成边界的导入/加载声明：`import { defineConfig } from "vite"`；`import { resolve } from "path"`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/vite.content.config.ts#L1-L35)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
