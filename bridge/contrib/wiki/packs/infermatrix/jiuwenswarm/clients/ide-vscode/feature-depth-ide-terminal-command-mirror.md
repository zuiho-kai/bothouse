---
name: feature-depth-ide-terminal-command-mirror
description: 终端命令镜像实现深读：VS Code runCommand 惰性建立并复用 JiuwenSwarm 终端、extractCommand/extractArguments 多形态载荷解析、JetBrains runCommandsInTerminal 守卫与反射 TerminalView 的静默降级
metadata:
  scope: 只收 TerminalManager（VS Code 与 JetBrains）的实现级事实；功能概览与 ChatPanel 镜像数据流归 feature-ide-terminal-command-mirror，ChatPanel 总体归 ide-vscode-knowledge
---
# IDE 终端命令镜像执行：实现深读

## 现状

- [[feature-ide-terminal-command-mirror]]（功能概览） · [[ide-vscode-overview]]（owner 入口）
- **VS Code runCommand：模块级 activeTerminal 惰性建、复用并 show() 后 sendText** runCommand 在模块级 activeTerminal 为空时创建名为 'JiuwenSwarm' 的终端，cwd 取传入值，否则回退第一个工作区文件夹（无工作区时为 undefined）；随后 activeTerminal.show() 并 sendText(command)，命令文本不在此分支解析或校验。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L3–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L3-L18)
- **extractCommand/extractArguments：多形态 payload 解析，返回首个命中键的 trim 后字符串或 undefined** extractCommand 取 extractArguments 结果、payload.arguments 或 payload 本身作为 args（非对象则返回 undefined），再取 command/cmd/shell_cmd/bash_command 中首个真值并 String(...).trim()。
  - extractArguments 优先 tool_call.arguments，tool_call 为对象但无对象型 arguments 时返回 tool_call 本身（此时不再查 tool_input/input），否则依次取 tool_input、input。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L34–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L34-L65)
- **JetBrains runCommand 受设置 runCommandsInTerminal 守卫，文档默认为开** Kotlin runCommand 在执行前检查 JiuwenSwarmSettings.instance().runCommandsInTerminal，为假即 return。JetBrains 设置文档列出「在 IDE 终端中运行命令」默认值为「开」。所示 VS Code runCommand 片段不读取任何配置项。
- 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L40–L47
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt#L40-L47`）,
  - [docs/zh/ide/jetbrains/JetBrains插件.md:L13–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/jetbrains/JetBrains%E6%8F%92%E4%BB%B6.md#L13-L24),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L9–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L9-L18)
- **Kotlin 侧经反射耦合 TerminalView/ShellTerminalWidget；VS Code 侧依赖 vscode.window 终端 API** Kotlin init 通过 Class.forName 解析 org.jetbrains.plugins.terminal.TerminalView 与 ShellTerminalWidget 的方法，编译期不依赖 Terminal 插件；VS Code 直接调用 vscode.window.createTerminal/show/sendText。
  - Kotlin 还依赖 ToolWindowManager 取 "Terminal" 工具窗。
- 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L23–L38
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt#L23-L38`）,
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L9–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L9-L18)
- **Kotlin 反射缺失或执行异常被捕获并降级为日志；VS Code dispose 吞掉异常** Kotlin init 反射失败时记 LOG.info 并让 Method 保持 null，runCommand 随后因 tv/gi 等为 null 提前 return（终端集成禁用）；runCommand 体内异常被 catch 记 LOG.warn。VS Code disposeTerminal 用 try/catch 忽略 dispose 异常并将 activeTerminal 置 undefined。
  - extractCommand 在无命令键时返回 undefined，由调用方决定后续。
- 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L23–L65
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt#L23-L65`）,
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L20–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L20-L48)
- **JetBrains 端反射调用 Terminal API：编译期解耦，代价是初始化失败即静默禁用** 设计推断（非作者历史意图）：
- TerminalManager 在 init 中通过 Class.forName/getMethod 反射获取 TerminalView 与 ShellTerminalWidget 的方法句柄，任何 Exception 仅 LOG.info 后继续，runCommand 中任一句柄为 null 即直接 return。推断（非作者意图）：这使插件可在缺少 Terminal 插件时编译，但运行时集成失败只留下日志，命令镜像被静默跳过。
- 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L10–L38
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt#L10-L38`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L40–L47
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt#L40-L47`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-vscode/feature-depth-ide-terminal-command-mirror.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L40-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/jetbrains/JetBrains插件.md:L13-L24；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L9-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L23-L38
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L23-L65
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L20-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L3-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L34-L65
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L10-L38
- 源页字段（feature）：ide-terminal-command-mirror
- 入口（entry_points）：jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts；jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts
- 源页字段（source_globs）：jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts；jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts；jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt
