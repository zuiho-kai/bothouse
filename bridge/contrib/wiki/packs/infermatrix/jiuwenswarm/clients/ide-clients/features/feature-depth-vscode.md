---
name: feature-depth-vscode
description: VS Code 客户端实现深读：jiuwenswarm.host 决定 ws/wss 与默认值（端口 19000、channelId ide）、ChatPanel.show 流程、SessionManager.loadHistory 返回值、sendGitStatus 静默吞错、localhost 改写为 127.0.0.1 的取舍、loadHistoryOnSwitch 手动步骤（未执行）
metadata:
  scope: 只收 VS Code 扩展（extension.ts、WsClient、ChatPanel、SessionManager）的实现级事实；职责、接口入口与验证建议的概览归 feature-vscode，JetBrains 端的实现深读归 feature-depth-jetbrains
---
# VS Code 客户端：实现深读

## 现状

- [[feature-vscode]]（功能概览） · [[ide-clients-overview]]（owner 入口）
- **host 决定 ws/wss 及默认值** jiuwenswarm.host 默认 '127.0.0.1'、port 默认 19000、channelId 默认 'ide'、autoConnect 默认 true；host 为空/127.0.0.1/localhost/::1 时用 ws，其余值用 wss。keepAlive.enabled 默认 true、interval 默认 30（秒），enabled 为 false 时 pingIntervalMs 传 0、startPing 直接跳过心跳。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts:L21–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts#L21-L39),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts:L145–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts#L145-L152)
- **ChatPanel.show()：面板已存在则 reveal 并刷新后返回，否则创建 webview、接线并启动轮询** panel 已存在时 reveal(Beside) 后 sendCurrentStatus()+refreshMetrics() 即返回；
  - 否则创建 'JiuwenSwarm' webview（enableScripts、retainContextWhenHidden），html 取自 getHtml，注册 onDidReceiveMessage→handleWebviewMessage 与 onDidDispose（停内存轮询、清 disposables 与 pending、panel=undefined）；末尾仅 ws.isConnected() 时 sendCurrentStatus()，随后 refreshMetrics()+startMemoryPolling()。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L63–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L63-L103)
- **SessionManager.loadHistory(sid, pageIdx=1)：返回 ws.send 布尔值，历史数据不随返回值给出** 构造 'history.get' 请求（带 this.channelId）并 `return this.ws.send(msg)`：socket readyState 非 OPEN 时返回 false；按所示注释，历史以 history.message 事件流至所有 message 监听者、history.done 标记页尾——调用方须从事件消费而非等待返回值。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/client/SessionManager.ts:L161–L170](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/client/SessionManager.ts#L161-L170),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts:L102–L106](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts#L102-L106)
- **sendGitStatus 对 git 失败静默吞并；branch 为空或 'HEAD' 直接 return** sendGitStatus() 内两条 execSync（git rev-parse --abbrev-ref HEAD 与 git status --porcelain，各配置 timeout: 3000）任一抛出即被 catch 静默吞掉（注释：非 git 仓库或 git 不可用），不 postToWebview git_status；branch 为空或等于 'HEAD'（detached）时也直接 return 不发送。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L953–L966](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L953-L966)
- **构造时无条件把 localhost 改写为 127.0.0.1：IPv4 兼容换 IPv6 不可达（代价为推断）** 设计推断（非作者历史意图）：
- WsClient 构造函数无条件执行 url.replace('://localhost:', '://127.0.0.1:')。收益（源码注释）：避免 macOS Node 17+ 先把 localhost 解析为 ::1、对仅监听 IPv4 的服务器立即连接失败。代价（推断）：仅监听 IPv6 的 localhost 服务端会被改写而无法连接。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts:L23–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts#L23-L31)
- **文档化手动步骤：开启 loadHistoryOnSwitch 切换会话后历史自动流式加载（本轮未执行）** 文档中的人工验收步骤（本轮未执行）：
- 现有文档记录的操作与预期结果：保持 `jiuwenswarm.loadHistoryOnSwitch` 开启（文档默认 true），点击 ⚙ → 会话 切换到已有会话，预期历史消息自动流式加载。该手动步骤本轮未执行，仅为文档记载。
- 来源：[docs/zh/ide/vscode/VSCode插件.md:L23–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/vscode/VSCode%E6%8F%92%E4%BB%B6.md#L23-L23),
  - [docs/zh/ide/vscode/VSCode插件.md:L109–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/vscode/VSCode%E6%8F%92%E4%BB%B6.md#L109-L112)
- **activate 内单一 WsClient 注入 SessionManager、StatusBar 与 ChatPanel；仅 autoConnect 为真才调用 ws.connect()** activate 中以 url 和 pingIntervalMs 创建一个 WsClient，同一 ws 实例先后传入 SessionManager、StatusBar 和 ChatPanel。
  - ChatPanel 构造函数用参数属性保存 ws 与 session，在 this.ws 上注册 status/message 监听器并向 session 注册会话监听器，对应注销回调存入 disposables（仅注册，不证明已执行清理）。autoConnect 为真时 activate 才调用 ws.connect()，这些构造期绑定不等于网络已连接。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts:L20–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts#L20-L47),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L40–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L40-L61)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/feature-depth-vscode.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts:L21-L39
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts:L145-L152；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/vscode/VSCode插件.md:L23-L23
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/vscode/VSCode插件.md:L109-L112；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L63-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/client/SessionManager.ts:L161-L170
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts:L102-L106
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L953-L966
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts:L23-L31
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts:L20-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L40-L61
- 源页字段（feature）：vscode
- 入口（entry_points）：jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts
- 源页字段（source_globs）：jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts；jiuwenswarm/channels/ide/packages/vscode-extension/*
