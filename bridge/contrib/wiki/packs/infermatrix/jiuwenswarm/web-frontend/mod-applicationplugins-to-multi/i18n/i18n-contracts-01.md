---
name: i18n-contracts-01
description: i18n 源码接口 01：src/i18n/index.ts 的词法声明（resources）与导入依赖
metadata:
  scope: 只收 i18n/index.ts 一个文件的接口记录；目录入口归 i18n-overview
---
# i18n 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/i18n/index.ts`**
- 源码声明的类型、组件或调用边界：`resources`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import i18n from 'i18next';`；`import { initReactI18next } from 'react-i18next';`；`import LanguageDetector from 'i18next-browser-languagedetector';`；`import zh from './locales/zh.json';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L1-L30)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/i18n/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
