---
name: feature-depth-browser-client
description: Chromium 浏览器扩展实现深读：SEND_AGENT 输入输出契约、上下文折叠进 content、无活动会话错误信封、设置页缺省、ContextCache 测试断言
metadata:
  scope: 收 background/index.ts 与侧栏之间发送路径的实现深读（来源链接到 index.ts、ContextCache.ts、ContextCache.test.ts、SessionManager.ts）；功能入口归 feature-browser-client，owner 入口归 browser-client-overview
---
# Chromium 浏览器扩展：实现深读

## 现状

- [[feature-browser-client]]（功能概览） · [[browser-client-overview]]（owner 入口）
- **SEND_AGENT 的输入/输出契约** MSG.SEND_AGENT 请求携带 message 与可选 tabId；若无活动会话，handler 通过 port 回发 {type:"error", payload:{message:"No active session"}} 并直接返回。调用方义务是先存在活动会话，页面上下文由后台折叠进 content 字段而非独立 context 参数。
- 来源：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L211–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L211-L249)
- **上下文折叠进 content 与易失缓存** 设计推断（非作者历史意图）：
- 网关只用 content/query 构建提示、独立 context 参数会被忽略，因此扩展把页面上下文直接拼进 content（推理：这是为兼容网关协议而做的客户端折衷，代价是用户消息与机器提取文本混在同一字段）。ContextCache 刻意做成内存易失缓存以适应服务挂起，持久性交给 storage.ts 的固定页面。
- 来源：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L236–L248](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L236-L248),
  - [jiuwenswarm/channels/browser/frontend/src/background/ContextCache.ts:L1–L12](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/ContextCache.ts#L1-L12)
- **handleSendAgent：无活动会话时向来源端口回发错误并 return，否则聚合上下文后经 client.send 发送** 端口 onMessage 回调将未类型化 JSON 转型后交给 handleSidePanelMsg，按 sidePanelHandlers 查表分发。handleSendAgent 以 msg.action 为守卫；activeSessionId 为空时向该 port 回发 {type:"error"} 并局部 return；
  - 否则把 cache.aggregate(tabIds, MAX_CONTEXT_CHARS) 得到的 context（非空时与 message 以 --- 拼接为 fullContent）作为 content/query，经 client.send(GW_METHOD.CHAT_SEND, {content, query, session_id}) 发送。
- 来源：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L117–L135](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L117-L135),
  - [jiuwenswarm/channels/browser/frontend/src/background/index.ts:L202–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L202-L249)
- **设置页可配置项与代码内缺省（文档未示具体默认值）** 文档声明设置页可配置服务器主机、端口、默认会话模式与行为开关，但未给出具体默认值。代码内可见缺省/优先级：会话行 mode 为 (ss.mode) || "chat"；handleBgMsg 归一键为 action ?? type ?? ""，action 优先，使同一 switch 兼容后台回复与服务器原始信封。
- 来源：[docs/zh/browser-extension/浏览器扩展.md:L25–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/browser-extension/%E6%B5%8F%E8%A7%88%E5%99%A8%E6%89%A9%E5%B1%95.md#L25-L36),
  - [jiuwenswarm/channels/browser/frontend/src/background/SessionManager.ts:L90–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/SessionManager.ts#L90-L93),
  - [jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts:L149–L153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts#L149-L153)
- **后台-侧栏端口耦合与 ContextCache/tabWatcher 上下文依赖** sessionMgr.onChange 与服务器流信封都经 broadcastToSidePanel 下发，侧栏因此以 action ?? type 双键分发（注释明言两类消息键不同）。发送路径耦合 ContextCache.aggregate、tabWatcher.extractFromTab 与固定页存储，页面上下文须折叠进 content 才被网关使用。
- 来源：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L60–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L60-L64),
  - [jiuwenswarm/channels/browser/frontend/src/background/index.ts:L211–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L211-L249),
  - [jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts:L149–L153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts#L149-L153)
- **无活动会话与错误信封的守卫分支及传播** 触发 !sessionMgr.activeSessionId：handleSendAgent 不发网关请求，向来源 port 回 {type:"error",payload:{message:"No active session"}}；侧栏 error 分支 endTurn() 后渲染 humanizeError（消息缺省 "Unknown error"）。setActiveSession 遇未知 id 仅 log.warn 返回，不切换。
- 来源：[jiuwenswarm/channels/browser/frontend/src/background/index.ts:L211–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L211-L249),
  - [jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts:L174–L179](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts#L174-L179),
  - [jiuwenswarm/channels/browser/frontend/src/background/SessionManager.ts:L161–L170](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/SessionManager.ts#L161-L170)
- **ContextCache 所示用例直接断言 helper 的存取与截断（helper_unit）** ContextCache.test.ts 直接 new ContextCache()：L17–L25 断言 set/get/delete 往返，L45–L51 断言 aggregate 在超过 maxChars 时输出含 "truncated"；这些断言仅作用于该 helper 的方法，而 handleSendAgent 在 L233/L236 使用 cache.set 与 cache.aggregate。
- 来源：[jiuwenswarm/channels/browser/frontend/tests/ContextCache.test.ts:L17–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/tests/ContextCache.test.ts#L17-L25),
  - [jiuwenswarm/channels/browser/frontend/tests/ContextCache.test.ts:L45–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/tests/ContextCache.test.ts#L45-L51),
  - [jiuwenswarm/channels/browser/frontend/src/background/index.ts:L230–L236](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/background/index.ts#L230-L236)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/feature-depth-browser-client.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/index.ts:L211-L249；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/index.ts:L236-L248
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/ContextCache.ts:L1-L12；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/browser-extension/浏览器扩展.md:L25-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/SessionManager.ts:L90-L93
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts:L149-L153；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/index.ts:L60-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts:L174-L179
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/SessionManager.ts:L161-L170
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/index.ts:L117-L135；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/index.ts:L202-L249
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/tests/ContextCache.test.ts:L17-L25；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/tests/ContextCache.test.ts:L45-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/browser/frontend/src/background/index.ts:L230-L236
- 源页字段（feature）：browser-client
- 入口（entry_points）：jiuwenswarm/channels/browser/frontend/src/background/index.ts；jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts
- 源页字段（source_globs）：jiuwenswarm/channels/browser/frontend/src/background/index.ts；jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts；jiuwenswarm/channels/browser/frontend/src/*
