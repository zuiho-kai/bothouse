---
name: ide-clients-knowledge
description: JetBrains 插件（ide-clients）架构与行为：JiuwenSwarmService 单例、JiuwenSwarmSettings 默认值（19000 端口、ws/wss 判定）、SessionManager 请求契约、子进程 git 与强制 IPv4、IDE 上下文注入与编辑拦截
metadata:
  scope: 只收 JetBrains 插件的架构、配置、验收路径、API 契约、取舍与功能六段；VS Code 客户端的深读与逐文件声明不在本页
---
# JetBrains 插件（ide-clients）：架构、API、配置与行为

## 现状

- **应用级单例组合 WsClient 与 SessionManager**
- JiuwenSwarmService 是注册为 applicationService 的应用级单例（实现 Disposable），构造时从 JiuwenSwarmSettings 读取 wsUrl 与保活参数创建 WsClient，再把 ws 与 channelId 交给 SessionManager；dispose 时依次关闭重试线程、session 与 ws。
  - 数据流为：WsClient 解析 JSON 消息后广播给 message 监听者，SessionManager 消费 res/event 完成请求 Future 与 connection.ack 会话建立，DiffApplier/ContextCollector/SwarmStateManager 处理各自的工具调用、上下文与团队事件。
- Sources / 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L15–L30
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt#L15-L30`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/WsClient.kt:L130–L138
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/WsClient.kt#L130-L138`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L275–L337
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt#L275-L337`）
- **JiuwenSwarmSettings：持久化状态与 ws/wss 判定**
- 设置以 PersistentStateComponent 存于 jiuwenswarm.xml，默认 host=127.0.0.1、port=19000、channelId="ide"、defaultMode="code.plan"、autoConnect=true、keepAliveInterval=30（写入时钳制 5–300）、projectTreeMaxFiles=200（10–2000）、autoApplyEdits/approveEdits/gitEnabled 默认关闭。
  - wsUrl 按 host 是否为本机（空/127.0.0.1/localhost/::1）选择 ws 或 wss，路径固定 /ws；文档设置表与这些默认值一致。
- Sources / 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt:L8–L40
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt#L8-L40`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt:L110–L120
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt#L110-L120`）,
  - [docs/zh/ide/jetbrains/JetBrains插件.md:L15–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/jetbrains/JetBrains%E6%8F%92%E4%BB%B6.md#L15-L30)
- **文档化的手动验收路径**
- 本批输入未包含插件自身的自动化测试；docs/zh/ide/jetbrains/JetBrains插件.md 记录了手动验收预期：编辑工具被插件拦截，默认打开并排 diff 窗口（关闭即应用），自动应用模式经 WriteCommandAction 写入且可 Ctrl+Z 撤销，要求批准模式在 diff 或应用前弹确认；shell 命令在专用 JiuwenSwarm 终端标签页中运行并复用。这些是文档声明，本轮未对照运行验证。
- Sources / 来源：[docs/zh/ide/jetbrains/JetBrains插件.md:L96–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/jetbrains/JetBrains%E6%8F%92%E4%BB%B6.md#L96-L108)
- **SessionManager request/send contracts**
- The private request(method, params, sid) builds a `type:"req"` message, registers a CompletableFuture keyed by UUID, and blocks up to 5 seconds (REQUEST_TIMEOUT_SEC); it fail-fasts with `check(!isDispatchThread)` so callers must run off the EDT, and throws IllegalStateException if ws.send fails.
  - sendChat returns false without sending when sessionId is null; interrupt() sends `chat.interrupt` fire-and-forget and discards the ws.send result (no Boolean return).
- Sources / 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L240–L273
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt#L240-L273`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L159–L167
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt#L159-L167`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L222–L231
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt#L222-L231`）
- **Subprocess git and forced IPv4**
- Inference / 设计推断（非作者历史意图）：
- GitContextProvider shells out to `git` instead of git4idea to keep a single-module, dependency-free plugin that works across JetBrains IDEs (per its doc comment); the cost is that runGit reads stdout to EOF before the 5-second waitFor,
  - so a hung git process can block collection rather than hitting the timeout. WsClient unconditionally rewrites `://localhost:` to `://127.0.0.1:` (inference: avoids macOS IPv6-first resolution failures at the cost of unreachable IPv6-only local servers).
- Sources / 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/GitContextProvider.kt:L8–L16
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/GitContextProvider.kt#L8-L16`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/GitContextProvider.kt:L51–L63
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/GitContextProvider.kt#L51-L63`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/WsClient.kt:L29–L32
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/WsClient.kt#L29-L32`）
- **自动 IDE 上下文注入与代理文件编辑拦截**
- ContextCollector.collect 汇集活动文件/光标/选区/诊断、其他打开标签、可选项目树、git 子进程摘要、项目规则与 @提及文件，组成 `<!-- IDE Context -->` 结构块；sendChat 将该块拼接在用户 content 之后（"$content\n\n$ideContext"）随 chat.send 发送，还可携带图片 media_items 与 model_name。
  - DiffApplier 拦截 str_replace_editor / edit_file / write_file / create_file 的工具调用事件：默认弹出并排 diff（当前 vs 拟议），autoApplyEdits 开启时经 WriteCommandAction 直接写入，approveEdits 开启时先弹确认对话框。
- Sources / 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/ContextCollector.kt:L27–L48
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/ContextCollector.kt#L27-L48`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L166–L190
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt#L166-L190`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L27–L38
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt#L27-L38`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L184–L215
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt#L184-L215`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt:L15-L30
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/WsClient.kt:L130-L138
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L275-L337
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt:L8-L40
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt:L110-L120
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/jetbrains/JetBrains插件.md:L15-L30；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/jetbrains/JetBrains插件.md:L96-L108
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L240-L273
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L159-L167
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L222-L231
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/GitContextProvider.kt:L8-L16
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/GitContextProvider.kt:L51-L63
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/WsClient.kt:L29-L32
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/ContextCollector.kt:L27-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt:L166-L190
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L27-L38
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L184-L215
