---
name: feature-ide-terminal-command-mirror
description: IDE 终端命令镜像执行（VS Code 扩展与 JetBrains 插件）：bash/run_command 镜像到 JiuwenSwarm 终端与复用、TerminalManager 模块契约、ChatPanel 数据流、runCommandsInTerminal 开关、JetBrains 反射集成取舍
metadata:
  scope: 只收终端命令镜像功能的行为、契约、数据流、开关与取舍概览；逐条实现深读归 feature-depth-ide-terminal-command-mirror，目录入口归 ide-vscode-overview
---
# IDE 终端命令镜像执行（VS Code 扩展与 JetBrains 插件）

## 现状

- **支持的镜像行为与终端复用**
- 功能将 agent 的 `bash`/`run_command` 工具调用镜像到用户可见的 IDE 终端，展示实时输出。VS Code 端按会话复用单个名为 JiuwenSwarm 的终端，首次命令时惰性创建，每次执行前 `show()` 前置；JetBrains 端同样按终端标题 "JiuwenSwarm" 查找既有 widget，不存在时调用 `createLocalShellWidget(project.basePath, "JiuwenSwarm")` 新建，执行后把 Terminal 工具窗口带到前台。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L5–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L5-L18),
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L49–L61
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt#L49-L61`）
- **验证**
- Inference / 设计推断（非作者历史意图）：
- 所示文件片段中未包含针对 TerminalManager 或命令镜像路径的测试代码；ChatPanel 中的 `this.debug(\`TERM  → ${cmd}\`)` 调试日志是运行时确认命令提取与镜像触发点的可观测入口。无法据此判断仓库其他位置是否存在相关测试。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L408–L418](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L408-L418)
- **TerminalManager 模块契约（VS Code）**
- VS Code 扩展的 `terminal/TerminalManager.ts` 导出三个函数：`runCommand(command: string, cwd?: string): void` 在名为 JiuwenSwarm 的终端中执行命令，首次调用时惰性创建终端，之后 `show()` 并 `sendText(command)`；`disposeTerminal(): void` 释放并清空缓存的终端引用；`extractCommand(payload)` 从工具调用负载中提取命令字符串，找不到时返回 undefined。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L9–L27](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L9-L27),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L34–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L34-L47)
- **ChatPanel 中的命令镜像数据流**
- ChatPanel 处理服务器消息时，对 `event_type === 'chat.tool_call'` 且工具名为 `bash` 或 `run_command` 的调用进行镜像：先读取配置 `runCommandsInTerminal`（默认 true），为真时调用 `extractCommand(payload)` 提取命令，仅当提取结果非空时调用 `runCommand(cmd)` 在 IDE 终端执行，并输出 `TERM →` 调试日志。该分支位于文件编辑工具调用处理之后，同一个 tool_call 事件内。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L354–L418](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L354-L418)
- **runCommandsInTerminal 开关**
- VS Code 端在 ChatPanel 处理 `chat.tool_call` 时读取工作区配置 `jiuwenswarm.runCommandsInTerminal`，调用点传入回退值 `cfg.get<boolean>('runCommandsInTerminal', true)`；为真且 `extractCommand` 提取到非空命令时才镜像执行。JetBrains 端在 `runCommand` 开头读取 `JiuwenSwarmSettings.instance().runCommandsInTerminal`，为 false 时直接 return；
  - 所示代码未包含该设置的定义或默认值，其未配置时的取值无法从本片段确定。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L408–L418](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L408-L418),
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L40–L43
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt#L40-L43`）
- **反射集成与容错取舍（JetBrains）**
- JetBrains 端通过反射查找 `org.jetbrains.plugins.terminal.TerminalView` 等类，代码注释明说这是为了在构建期缺少 Terminal 插件时仍可编译（运行期随 IDE 捆绑）。代价是：`init` 中任一反射查找失败只记录一条 info 日志（"terminal integration disabled"），后续 `runCommand` 因方法句柄为 null 直接 return，集成静默降级；查找既有 widget 时的标题反射失败按 false 处理并继续，可能导致重复创建名为 JiuwenSwarm 的终端。
- Sources / 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L10–L38
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt#L10-L38`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L44–L58
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt#L44-L58`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-vscode/feature-ide-terminal-command-mirror.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L5-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L49-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L408-L418
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L9-L27
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L34-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L354-L418
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L40-L43
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L10-L38
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt:L44-L58
- 源页字段（feature）：ide-terminal-command-mirror
- 入口（entry_points）：jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts；jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts
- 源页字段（source_globs）：jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts；jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts；jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/terminal/TerminalManager.kt
