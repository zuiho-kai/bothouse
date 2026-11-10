---
name: feature-depth-jetbrains
description: JetBrains 客户端实现深读：保活与 autoConnect 设置的消费、CONNECTED 后 15 秒无 sessionId 才重连一次（ackRetryPending 去重）、sendChat 无会话返回 false、Swarm Map 调试日志默认关闭的文档化手动步骤（未执行）
metadata:
  scope: 只收 JetBrains 客户端（JiuwenSwarmService、WsClient、SessionManager）的实现级事实；职责、接口入口、配置与验证建议的概览归 feature-jetbrains，VS Code 端的实现深读归 feature-depth-vscode
---
# JetBrains 客户端：实现深读

## 现状

- [[feature-jetbrains]]（功能概览） · [[ide-clients-overview]]（owner 入口）
- **保活与自动连接设置的消费方式** 构造 WsClient 时读 settings.wsUrl，且仅当 settings.keepAliveEnabled 为真时传入 settings.keepAliveInterval（否则传 0）。文档记录保活 ping 间隔默认 30 秒（5–300）、「启动时连接」默认开；autoConnect 仅控制 init 中是否立即 ws.connect()。
- 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L21–L26
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt#L21-L26`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L39–L42
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt#L39-L42`）,
  - [docs/zh/ide/jetbrains/JetBrains插件.md:L20–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/jetbrains/JetBrains%E6%8F%92%E4%BB%B6.md#L20-L25)
- **固定 15 秒延迟的一次性检查** 设计推断（非作者历史意图）：
- 推断：选择「CONNECTED 后固定等 15 秒再检查 sessionId」而非立即重连，收益是给服务器预热（注释称约 8 秒）留出缓冲、避免高频重连；代价是固定延迟不随服务器实际就绪时间调整，且标志在回调内先被清除，可能随每次重连周期重复触发调度。
- 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L52–L61
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt#L52-L61`）
- **CONNECTED 后 15 秒仍处于连接且无会话 ID 才重连一次** 状态监听器在 WsStatus.CONNECTED 时调用 scheduleAckRetry：仅当 ackRetryPending 为假才置真并调度 15 秒任务，任务先复位标志，再在 ws.isConnected() 且 session.sessionId == null 时记日志并调用 ws.reconnect()；reconnect 在未销毁时取消重试定时、retryCount 清零、以 1000 关闭旧 ws 后 connect()。
- 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L43–L49
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt#L43-L49`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L52–L61
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt#L52-L61`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/WsClient.kt:L82–L89
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/WsClient.kt#L82-L89`）
- **sendChat：无会话时返回 false；所示行构造 chat.send 请求至 params.content** sendChat(content, mode, requestId, ideContext=null, mediaItems=null, model=null): Boolean——sessionId 为 null 时直接返回 false，调用方须先建立会话；ideContext 非空白时拼为 content 加空行再加 ideContext；
  - 所示行构造 id=requestId、type="req"、channel_id=channelId、method="chat.send" 的消息，内容止于 params 的 content 字段。
- 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L159–L179
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt#L159-L179`）
- **服务构造读取 JiuwenSwarmSettings：保活开关决定传入间隔，autoConnect 决定首连** JiuwenSwarmService 构造时以 settings.wsUrl 创建 WsClient，仅当 keepAliveEnabled 为真才传入 keepAliveInterval，否则传 0；settings.channelId 传入 SessionManager；init 仅当 settings.autoConnect 为真才调用 ws.connect()。文档记录默认值：启动时连接=开，保活 ping 间隔 30 秒（5–300）。
- 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L21–L26
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt#L21-L26`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L39–L42
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt#L39-L42`）,
  - [docs/zh/ide/jetbrains/JetBrains插件.md:L15–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/jetbrains/JetBrains%E6%8F%92%E4%BB%B6.md#L15-L25)
- **缺少 connection.ack 时的一次性 15 秒重连（去重且断开重置）** 触发：服务器未就绪时连接后跳过 connection.ack。防护分支：CONNECTED 进入 scheduleAckRetry，ackRetryPending 去重；15 秒后仅当 ws.isConnected() 且 session.sessionId==null 才记日志并 ws.reconnect() 一次；DISCONNECTED/RECONNECTING 把 ackRetryPending 置回 false。
- 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L31–L62
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt#L31-L62`）
- **Swarm Map 调试日志默认关闭的文档化手动观察步骤（未执行）** 文档中的人工验收步骤（本轮未执行）：
- 文档记载 Swarm Map 的 ☰ 菜单 → 调试日志 默认关闭；手动开启后预期实时显示团队事件与工具归属日志，并带清除/复制。此为现有文档化手动步骤，本次未执行（NOT EXECUTED）。
- 来源：[docs/zh/ide/jetbrains/JetBrains插件.md:L147–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/jetbrains/JetBrains%E6%8F%92%E4%BB%B6.md#L147-L147)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/feature-depth-jetbrains.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L21-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L39-L42
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/jetbrains/JetBrains插件.md:L20-L25
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L52-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L31-L62
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L159-L179
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/jetbrains/JetBrains插件.md:L15-L25
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L43-L49
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/WsClient.kt:L82-L89
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/jetbrains/JetBrains插件.md:L147-L147
- 源页字段（feature）：jetbrains
- 入口（entry_points）：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt
- 源页字段（source_globs）：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt；jiuwenswarm/channels/ide/packages/jetbrains-plugin/*
