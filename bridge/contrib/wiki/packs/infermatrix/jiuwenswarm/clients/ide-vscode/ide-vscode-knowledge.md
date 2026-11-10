---
name: ide-vscode-knowledge
description: ide-vscode：VS Code ChatPanel 作为消息枢纽、文件编辑拦截与快照回退、终端镜像与 Git/内存辅助、TerminalManager 入口、jiuwenswarm.* 设置回退值（rewindEnabled、useDiffViewer、runCommandsInTerminal）、调试日志开关
metadata:
  scope: 只收 VS Code 扩展 ChatPanel 与终端命令镜像的架构、配置与验证入口；终端镜像功能页归 feature-ide-terminal-command-mirror，目录入口归 ide-vscode-overview
---
# ide-vscode：VS Code 聊天面板与终端命令镜像

## 现状

- **ChatPanel 作为扩展宿主中的消息枢纽**
- ChatPanel 是 VS Code 扩展侧的核心编排者：构造时订阅 WsClient 的 status/message 事件与 SessionManager 的会话变更，把服务端消息转换后转发给 webview，并在 dispose 时统一解绑。它还拥有 SwarmStateManager 与 SwarmMapPanel，服务端的 team.* 事件在 onJiuwenMessage 中被先行拦截（不转发给 webview），用于驱动 Swarm Map 的泳道状态。TerminalManager 则是模块级单例，持有唯一的 activeTerminal。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L46–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L46-L60),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L321–L343](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L321-L343),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L1–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L1-L17)
- **文件编辑拦截、终端镜像与 Git/内存辅助功能**
- onJiuwenMessage 拦截 str_replace_editor/write_file/create_file/edit_file 工具调用，按配置快照（rewindEnabled）并在 chat.final 时提升快照、显示回退条，用户发送下一条消息前可整体回退该轮修改；bash/run_command 则按 runCommandsInTerminal 镜像执行。
  - 此外 ChatPanel 每 10 秒轮询 session.getMemoryUsage() 推送给 webview，启用 gitEnabled 时通过 execSync 调 git 子进程实现状态展示与提交/推送快捷操作。JetBrains 文档描述了同构的终端集成与检查点/回退行为，VS Code 专属文档（VSCode插件.md）在所示片段中仅有标题，内容为空。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L355–L418](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L355-L418),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L929–L940](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L929-L940),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L1053–L1081](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L1053-L1081),
  - [docs/zh/ide/vscode/VSCode插件.md:L1–L2](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/vscode/VSCode%E6%8F%92%E4%BB%B6.md#L1-L2)
- **公开入口与生命周期**
- TerminalManager 是模块级单例，导出三个函数：runCommand(command, cwd?) 惰性创建名为 JiuwenSwarm 的终端并 sendText；disposeTerminal() 容错释放并置空引用；extractCommand(payload) 从多种 tool_call 载荷形态中提取 shell 命令。ChatPanel 实现 vscode.Disposable，公开 show()（创建或复用 webview 面板，ViewColumn.Beside，启用脚本并保留隐藏时上下文）、postToWebview(msg) 与 dispose()。
  - 消息缓冲语义在 postToWebview 中：面板不存在时直接丢弃；webview 未就绪时除 debug_log 外的消息进入 pendingWebviewMessages 队列，收到 ready 后由 flushPendingMessages 冲洗。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L9–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L9-L28),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L34–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts#L34-L48),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L63–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L63-L112)
- **jiuwenswarm.* 工作区设置（调用点读取）**
- ChatPanel 通过 vscode.workspace.getConfiguration('jiuwenswarm') 在调用点读取设置，所示代码中的回退值为：rewindEnabled=true（编辑前快照）、useDiffViewer=false（默认直接应用编辑）、runCommandsInTerminal=true（bash/run_command 镜像到 IDE 终端）、loadHistoryOnSwitch=true（切换会话时按 historyLoadedForSession 守卫只加载一次历史）、defaultMode='code.plan'、
  - gitEnabled=false（为 false 时不执行 git 状态采集与提交/推送处理分支）。注意 useDiffViewer 开启后仍有例外：无法计算拟议内容时回退为直接应用，用户拒绝 diff 时不应用编辑。所示片段未包含这些设置在 package.json 中的注册默认值；JetBrains 文档的设置表描述的是 JetBrains 插件，不能直接当作 VS Code 的注册配置。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L369–L404](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L369-L404),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L548–L557](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L548-L557),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L657–L674](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L657-L674),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L949–L965](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L949-L965)
- **调试日志开关与回退结果上报**
- 所示片段中可观察的验证入口有二：webview 的 toggle_debug 消息切换 debugEnabled，debug() 据此把带 [JiuwenSwarm] 前缀的日志输出到控制台并转发 debug_log 到 webview，覆盖发送、快照、diff、终端等关键路径；回退操作后 handleRewind 统计恢复与失败文件数并以 rewind_done 消息（如 "Rewound N file(s), M failed"）回报给 webview。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L199–L203](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L199-L203),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L1003–L1008](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L1003-L1008),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L929–L940](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L929-L940)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-vscode/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L46-L60
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L321-L343
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L1-L17
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L355-L418
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L929-L940
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L1053-L1081；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/vscode/VSCode插件.md:L1-L2
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L9-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts:L34-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L63-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L369-L404
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L548-L557
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L657-L674
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L949-L965
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L199-L203
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L1003-L1008
