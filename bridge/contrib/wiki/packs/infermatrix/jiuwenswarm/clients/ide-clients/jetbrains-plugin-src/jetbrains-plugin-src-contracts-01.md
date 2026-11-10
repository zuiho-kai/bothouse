---
name: jetbrains-plugin-src-contracts-01
description: JetBrains 插件 Kotlin 源码接口与集成边界 01：SessionManager、WsClient、ContextCollector、GitContextProvider、DiffApplier、JiuwenSwarmSettings、SettingsConfigurable、SwarmState、SwarmStateManager、TerminalManager、Actions、ChatToolWindow 的声明与导入
metadata:
  scope: 只收 jetbrains-plugin/src/main/kotlin 下 client 至 ui/ChatToolWindow.kt 的静态声明；FixWithAiIntention 之后的 ui 文件归 jetbrains-plugin-src-contracts-02
---
# jetbrains-plugin-src 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt`**
- 源码声明的类型、组件或调用边界：`val`, `SessionInfo`, `SessionManager`, `sessionId`, `sessionTitle`, `addSessionListener`, `removeSessionListener`, `dispose`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.client`；`import com.google.gson.Gson`；`import com.google.gson.JsonObject`；`import com.intellij.openapi.application.ApplicationManager`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/SessionManager.kt#L1-L343)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/WsClient.kt`**
- 源码声明的类型、组件或调用边界：`class`, `WsClient`, `pingIntervalSec`, `client`, `buildClient`, `setPingInterval`, `ws`, `status`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.client`；`import com.google.gson.Gson`；`import com.google.gson.JsonObject`；`import com.intellij.openapi.Disposable`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/client/WsClient.kt#L1-L155)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/ContextCollector.kt`**
- 源码声明的类型、组件或调用边界：`collect`, `collectProjectRules`, `collectMentionedFiles`, `gatherWorkspaceFiles`, `collectFilesFlat`, `buildProjectTree`, `buildProjectTreeInternal`, `readIdeData`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.context`；`import com.intellij.openapi.application.ReadAction`；`import com.intellij.openapi.editor.Editor`；`import com.intellij.openapi.editor.impl.DocumentMarkupModel`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/ContextCollector.kt#L1-L276)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/GitContextProvider.kt`**
- 源码声明的类型、组件或调用边界：`collect`, `runGit`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.context`；`import com.intellij.openapi.project.Project`；`import java.io.File`；`import java.util.concurrent.TimeUnit`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/context/GitContextProvider.kt#L1-L64)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt`**
- 源码声明的类型、组件或调用边界：`handle`, `handleOnEdt`, `handleEditFile`, `handleStrReplaceEditor`, `handleWriteFile`, `askApproval`, `applyStrReplace`, `writeEntireFile`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.editor`；`import com.google.gson.JsonElement`；`import com.google.gson.JsonObject`；`import com.google.gson.JsonParser`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt#L1-L310)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt`**
- 源码声明的类型、组件或调用边界：`JiuwenSwarmSettings`, `State`, `host`, `port`, `channelId`, `defaultMode`, `autoConnect`, `autoApplyEdits`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.settings`；`import com.intellij.openapi.application.ApplicationManager`；`import com.intellij.openapi.components.PersistentStateComponent`；`import com.intellij.openapi.components.State`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt#L1-L126)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/SettingsConfigurable.kt`**
- 源码声明的类型、组件或调用边界：`SettingsConfigurable`, `panel`, `modeLabel`, `modeCode`, `getDisplayName`, `createComponent`, `isModified`, `apply`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.settings`；`import com.intellij.openapi.options.Configurable`；`import com.intellij.ui.components.JBCheckBox`；`import com.intellij.ui.components.JBLabel`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/SettingsConfigurable.kt#L1-L168)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/swarm/SwarmState.kt`**
- 源码声明的类型、组件或调用边界：`LaneFeedEntry`, `at`, `AgentLane`, `displayName`, `role`, `status`, `executionStatus`, `currentTaskId`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.swarm`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/swarm/SwarmState.kt#L1-L49)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/swarm/SwarmStateManager.kt`**
- 源码声明的类型、组件或调用边界：`SwarmStateManager`, `sessionId`, `teamName`, `lastEventAt`, `applyTeamEvent`, `normalizeEvent`, `normalizeLaneStatus`, `applyToolCall`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.swarm`；`import com.google.gson.Gson`；`import com.google.gson.JsonObject`；`import com.intellij.openapi.diagnostic.logger`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/swarm/SwarmStateManager.kt#L1-L421)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt`**
- 源码声明的类型、组件或调用边界：`terminalViewClass`, `getInstanceMethod`, `getWidgetsMethod`, `createWidgetMethod`, `executeCommandMethod`, `runCommand`, `extractCommand`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.terminal`；`import com.intellij.openapi.diagnostic.logger`；`import com.intellij.openapi.project.Project`；`import com.intellij.openapi.wm.ToolWindowManager`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt#L1-L79)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/Actions.kt`**
- 源码声明的类型、组件或调用边界：`NewSessionAction`, `getActionUpdateThread`, `actionPerformed`, `update`, `SendSelectionAction`, `getActionUpdateThread`, `actionPerformed`, `update`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.ui`；`import com.intellij.openapi.actionSystem.ActionUpdateThread`；`import com.intellij.openapi.actionSystem.AnAction`；`import com.intellij.openapi.actionSystem.AnActionEvent`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/Actions.kt#L1-L77)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt`**
- 源码声明的类型、组件或调用边界：`ChatToolWindowFactory`, `createToolWindowContent`, `shouldBeAvailable`, `addFallback`, `ChatPanel`, `lastRequestId`, `activeModel`, `historyLoadedForSession`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.ui`；`import com.google.gson.Gson`；`import com.google.gson.JsonObject`；`import com.google.gson.JsonParser`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt#L1-L1069)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/jetbrains-plugin-src/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
