---
name: jetbrains-plugin-src-contracts-02
description: JetBrains 插件 Kotlin 源码接口与集成边界 02：FixWithAiIntention、StatusBarWidgetFactory、SwarmMapPanel、SwarmMapToolWindowFactory 的声明与导入
metadata:
  scope: 只收 jetbrains-plugin/src/main/kotlin/.../ui 下 FixWithAiIntention.kt 至 SwarmMapToolWindowFactory.kt 的静态声明；之前的文件归 jetbrains-plugin-src-contracts-01
---
# jetbrains-plugin-src 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/FixWithAiIntention.kt`**
- 源码声明的类型、组件或调用边界：`FixWithAiIntention`, `getText`, `getFamilyName`, `startInWriteAction`, `isAvailable`, `invoke`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.ui`；`import com.intellij.codeInsight.intention.IntentionAction`；`import com.intellij.openapi.application.ApplicationManager`；`import com.intellij.openapi.editor.Editor`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/FixWithAiIntention.kt#L1-L98)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/StatusBarWidgetFactory.kt`**
- 源码声明的类型、组件或调用边界：`StatusBarWidgetFactory`, `getId`, `getDisplayName`, `isAvailable`, `createWidget`, `disposeWidget`, `canBeEnabledOn`, `JiuwenStatusBarWidget`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.ui`；`import com.intellij.openapi.project.Project`；`import com.intellij.openapi.util.Disposer`；`import com.intellij.openapi.wm.StatusBar`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/StatusBarWidgetFactory.kt#L1-L122)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/SwarmMapPanel.kt`**
- 源码声明的类型、组件或调用边界：`SwarmMapPanel`, `onMessage`, `onLoadEnd`, `postSnapshot`, `postDebug`, `injectBridge`, `readSwarmMapHtml`, `fallbackHtml`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.ui`；`import com.google.gson.Gson`；`import com.intellij.openapi.Disposable`；`import com.intellij.openapi.application.ApplicationManager`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/SwarmMapPanel.kt#L1-L140)。
- **`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/SwarmMapToolWindowFactory.kt`**
- 源码声明的类型、组件或调用边界：`SwarmMapToolWindowFactory`, `createToolWindowContent`, `shouldBeAvailable`, `getPanel`, `removePanel`, `openOrReveal`, `findChatPanel`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`package com.jiuwenswarm.plugin.ui`；`import com.intellij.openapi.diagnostic.logger`；`import com.intellij.openapi.project.Project`；`import com.intellij.openapi.wm.ToolWindow`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/SwarmMapToolWindowFactory.kt#L1-L72)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/jetbrains-plugin-src/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
