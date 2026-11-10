---
name: browser-client-knowledge
description: browser-client 背景服务与内容脚本知识：WsClient/SessionManager/ToolDispatcher 数据流、八个页面适配器与右键菜单、eslint 与 pack.js 校验、Side Panel 回退取舍
metadata:
  scope: 只收 background service worker 与内容脚本的职责、ToolDispatcher 契约、页面适配器、校验打包入口、Side Panel 取舍五段知识；功能入口归 feature-browser-client，逐文件接口归 background-contracts-01、content-contracts-01、content-adapters-contracts-01
---
# JiuwenSwarm browser-client（Chromium 扩展）背景服务与内容脚本

## 现状

- **职责与数据流**
- background service worker 是扩展的中枢：维护到本地 JiuwenSwarm 服务器的 WebSocket 连接（gateway JSON-RPC，channel_id "browser"），管理研究会话、缓存页面上下文、注册右键菜单、监听标签页生命周期，并把服务器侧 agent 的 tool_call 信封分发给浏览器原生工具。
  - 各模块（WsClient、SessionManager、ContextCache、TabWatcher、ContextMenu、ToolDispatcher）作为单例在入口装配，入站事件按 ack / tool_call / 流式信封三类路由：ack 采纳会话，tool_call 进 ToolDispatcher，其余直接广播到侧栏端口。
- Sources / 来源：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L1–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L1-L13),
  - [jiuwenswarm/channels/browser/frontend/src/background/index.ts:L70–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L70-L93)
- **ToolDispatcher 的工具调用契约**
- ToolDispatcher.dispatch 接收服务器下发的 tool_call 信封（payload 含 tool/args/call_id），在 switch 内执行八个浏览器工具；执行体的异常被 try/catch 捕获并转为 {error: String(e)} 作为结果（L57-L96）。但 payload 解构与 onTool 回调位于 try 之前（L49-L55），该处抛出的异常会绕过结果发送；且结果经 client.send 发送，WsClient.send 在未连接时记录警告并返回 null（丢弃），不保证送达。
- Sources / 来源：[jiuwenswarm/channels/browser/frontend/src/background/ToolDispatcher.ts:L48–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/ToolDispatcher.ts#L48-L104),
  - [jiuwenswarm/channels/browser/frontend/src/background/WsClient.ts:L89–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/WsClient.ts#L89-L99)
- **页面适配器与上下文菜单行为**
- Extractor 按检测到的 pageType 分发到八个结构化适配器（github、arxiv、sec、pubmed、wikipedia、youtube、twitter、hackernews），其余走 Readability 兜底；pdf 类型不经适配器，直接返回提示需服务端 read_pdf 工具的 stub 上下文。
  - 右键菜单注册 ask/search/summarize/reader/pin 等项，其中 Pin 项标题仅在 onShown 检测到当前 URL 已被固定时更新为 "Unpin this page"（onShown/update 不可用时保持静态标题，切换仍经点击处理完成）。
- Sources / 来源：[jiuwenswarm/channels/browser/frontend/src/content/Extractor.ts:L33–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/Extractor.ts#L33-L56),
  - [jiuwenswarm/channels/browser/frontend/src/background/ContextMenu.ts:L91–L111](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/ContextMenu.ts#L91-L111)
- **工程级校验与打包入口**
- eslint.config.js 基于 typescript-eslint recommended，忽略 dist/、node_modules/、src/webview/，并将 no-explicit-any 与 no-unused-vars（argsIgnorePattern ^_）设为 warn 级提示。scripts/pack.js 在打包阶段校验构建产物存在：dist/ 缺失时报错并以退出码 1 终止（提示先 npm run build），否则将 dist/ 以 zip 压缩级别 9 归档为 jiuwenswarm-browser-<version>.zip 并输出体积日志。
  - 所列输入不含扩展运行时的测试文件。
- Sources / 来源：[jiuwenswarm/channels/browser/frontend/eslint.config.js:L3–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/eslint.config.js#L3-L13),
  - [jiuwenswarm/channels/browser/frontend/scripts/pack.js:L19–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/scripts/pack.js#L19-L29),
  - [jiuwenswarm/channels/browser/frontend/scripts/pack.js:L44–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/scripts/pack.js#L44-L48)
- **Side Panel 能力检测与弹窗回退的取舍**
- Inference / 设计推断（非作者历史意图）：
- PanelManager 以运行时检测 chrome.sidePanel 是否存在来分支（推断：这是为兼容不支持 Side Panel API 的 Chromium 系浏览器而保留的降级路径，文件头注释点名 360/QQ/搜狗浏览器）。原生分支仅在调用方传入 windowId 时才调用 chrome.sidePanel.open，否则直接返回不打开；回退分支以 420×700 的初始尺寸新建 popup，已打开时仅聚焦复用，窗口关闭时通过 onRemoved 清理记录的 ID。
- Sources / 来源：[jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts:L1–L10](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts#L1-L10),
  - [jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts:L33–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts#L33-L39),
  - [jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts:L54–L75](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts#L54-L75)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/index.ts:L1-L13；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/index.ts:L70-L93
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/ToolDispatcher.ts:L48-L104
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/WsClient.ts:L89-L99；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/content/Extractor.ts:L33-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/ContextMenu.ts:L91-L111；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/eslint.config.js:L3-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/scripts/pack.js:L19-L29；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/scripts/pack.js:L44-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts:L1-L10
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts:L33-L39
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/PanelManager.ts:L54-L75
