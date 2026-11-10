---
name: feature-browser-client
description: Chromium 浏览器扩展的职责、接口与配置：background/index.ts 与 sidepanel/index.ts 入口、init/broadcastToSidePanel/pinTabToSession 等声明、设计取舍、验证办法
metadata:
  scope: 只收浏览器扩展功能入口：职责与边界、API 入口、配置与生效条件、设计取舍、数据流、验证；实现深读归 feature-depth-browser-client，背景服务与内容脚本知识归 browser-client-knowledge，逐文件接口归 browser-client-contracts-01、background-contracts-01、content-contracts-01、content-adapters-contracts-01
---
# Chromium 浏览器扩展 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/feature-browser-client.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/index.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/browser-extension/浏览器扩展.md
- 源页字段（feature）：browser-client
- 入口（entry_points）：jiuwenswarm/channels/browser/frontend/src/background/index.ts；jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts
- 源页字段（source_globs）：jiuwenswarm/channels/browser/frontend/src/background/index.ts；jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts；jiuwenswarm/channels/browser/frontend/src/*；jiuwenswarm/channels/browser/frontend/src/sidepanel/reader.ts
  - jiuwenswarm/channels/browser/frontend/src/background/ToolDispatcher.ts；jiuwenswarm/channels/browser/frontend/src/content/index.ts；jiuwenswarm/channels/browser/frontend/src/content/Annotator.ts；jiuwenswarm/channels/browser/frontend/src/content/FormAssist.ts
  - jiuwenswarm/channels/browser/frontend/src/content/SelectionMonitor.ts；jiuwenswarm/channels/browser/frontend/src/background/ContextMenu.ts；jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts；jiuwenswarm/channels/browser/frontend/src/shared/constants.ts
  - jiuwenswarm/channels/browser/frontend/src/shared/types.ts；jiuwenswarm/channels/browser/frontend/src/shared/url.ts；jiuwenswarm/channels/browser/frontend/src/shared/i18n.ts；jiuwenswarm/channels/browser/frontend/src/shared/logger.ts
  - jiuwenswarm/channels/browser/frontend/src/background/WsClient.ts；jiuwenswarm/channels/browser/frontend/src/shared/protocol.ts；jiuwenswarm/channels/browser/frontend/src/shared/messages.ts；jiuwenswarm/channels/browser/frontend/src/shared/storage.ts
  - jiuwenswarm/channels/browser/frontend/src/options/index.ts；jiuwenswarm/channels/browser/frontend/src/options/options.html；jiuwenswarm/channels/browser/frontend/src/content/adapters/twitter.ts；jiuwenswarm/channels/browser/frontend/src/content/adapters/wikipedia.ts
  - jiuwenswarm/channels/browser/frontend/src/content/adapters/youtube.ts；jiuwenswarm/channels/browser/frontend/src/background/ContextCache.ts；jiuwenswarm/channels/browser/frontend/src/content/Extractor.ts；jiuwenswarm/channels/browser/frontend/src/content/PageTypeDetector.ts
  - jiuwenswarm/channels/browser/frontend/src/popup/index.ts；jiuwenswarm/channels/browser/frontend/src/popup/popup.html；jiuwenswarm/channels/browser/frontend/src/sidepanel/SessionExporter.ts；jiuwenswarm/channels/browser/frontend/src/background/TabWatcher.ts
  - jiuwenswarm/channels/browser/frontend/src/sidepanel/search.ts；jiuwenswarm/channels/browser/frontend/src/sidepanel/ChatBridge.ts；jiuwenswarm/channels/browser/frontend/src/sidepanel/chat.ts；jiuwenswarm/channels/browser/frontend/src/sidepanel/ContextBar.ts
  - jiuwenswarm/channels/browser/frontend/src/sidepanel/tour.ts；jiuwenswarm/channels/browser/frontend/src/sidepanel/privacy.ts；jiuwenswarm/channels/browser/frontend/src/sidepanel/sidepanel.html；jiuwenswarm/channels/browser/frontend/src/sidepanel/markdown.ts
  - jiuwenswarm/channels/browser/frontend/src/sidepanel/SessionPicker.ts；jiuwenswarm/channels/browser/frontend/src/webview/chat.html
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 浏览器扩展在页面旁提供 Agent 交互入口。扩展视图、浏览器页面上下文与后端会话分别维护，浏览器授权不自动替代服务端工具权限。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L1–L533](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L1-L533)；
  - [jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts:L1–L922](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts#L1-L922)；
  - [docs/zh/browser-extension/浏览器扩展.md:L1–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/browser-extension/%E6%B5%8F%E8%A7%88%E5%99%A8%E6%89%A9%E5%B1%95.md#L1-L117)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `init`；`broadcastToSidePanel`；`updatePinBadge`；`pinTabToSession`；`handleSidePanelMsg`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L1–L533](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L1-L533)；
  - [jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts:L1–L922](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts#L1-L922)；
  - [docs/zh/browser-extension/浏览器扩展.md:L1–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/browser-extension/%E6%B5%8F%E8%A7%88%E5%99%A8%E6%89%A9%E5%B1%95.md#L1-L117)。

### 配置入口与生效条件

- 配置与启用条件的权威入口是下列功能文档和实现的调用方。本页提供查证路由：先确认当前宿主、会话或运行模式，再检查文档中的操作条件与实现消费的输入；不把 UI 文案、文件名或方法名猜作可写配置键。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L1–L533](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L1-L533)；
  - [jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts:L1–L922](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts#L1-L922)；
  - [docs/zh/browser-extension/浏览器扩展.md:L1–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/browser-extension/%E6%B5%8F%E8%A7%88%E5%99%A8%E6%89%A9%E5%B1%95.md#L1-L117)。

### 设计取舍

- **设计推断**：扩展将多标签页提取内容汇成研究上下文并共享服务端会话，减少用户来回复制；代价是页面适配器、标签固定状态和服务器会话要协调。Side Panel 与弹窗是客户端显示方式，页面权限不能替代后端工具授权。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L1–L533](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L1-L533)；
  - [jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts:L1–L922](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts#L1-L922)；
  - [docs/zh/browser-extension/浏览器扩展.md:L1–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/browser-extension/%E6%B5%8F%E8%A7%88%E5%99%A8%E6%89%A9%E5%B1%95.md#L1-L117)。

### 数据流与关联功能

- 浏览器扩展在页面旁提供 Agent 交互入口。扩展视图、浏览器页面上下文与后端会话分别维护，浏览器授权不自动替代服务端工具权限。 联调时结合[[feature-browser-tools]]（浏览器服务与网页工具）、[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（项目、会话与历史管理）、[[feature-web-chat-1]]、[[feature-web-chat-2]]（Web 对话与流式状态）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L1–L533](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L1-L533)；
  - [jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts:L1–L922](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts#L1-L922)；
  - [docs/zh/browser-extension/浏览器扩展.md:L1–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/browser-extension/%E6%B5%8F%E8%A7%88%E5%99%A8%E6%89%A9%E5%B1%95.md#L1-L117)。

### 怎样验证

- 固定两个不同页面并提问，核对提取内容、来源和 Web 端同步的会话。检查特定站点与通用提取器、导出、断连和不支持 Side Panel 的显示回退，再验证移除页面后上下文符合预期。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L1–L533](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L1-L533)；
  - [jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts:L1–L922](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts#L1-L922)；
  - [docs/zh/browser-extension/浏览器扩展.md:L1–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/browser-extension/%E6%B5%8F%E8%A7%88%E5%99%A8%E6%89%A9%E5%B1%95.md#L1-L117)。
