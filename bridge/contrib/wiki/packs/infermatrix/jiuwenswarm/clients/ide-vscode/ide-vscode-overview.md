---
name: ide-vscode-overview
description: ide-vscode 目录入口：IDE 终端命令镜像执行功能的链接、ide vscode 的代码快速入口表（TerminalManager.ts、ChatPanel.ts）与知识页、功能页、实现深读页的链接
metadata:
  scope: 只收 ide-vscode 目录入口说明、链接与快速入口表；ChatPanel 与终端镜像的事实归 ide-vscode-knowledge，终端镜像功能归 feature-ide-terminal-command-mirror 与 feature-depth-ide-terminal-command-mirror
---
# ide-vscode

## 现状

- IDE 终端命令镜像执行 (`ide-terminal-command-mirror`)

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：ide vscode。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| ide vscode | 入口 | `jiuwenswarm/channels/ide/packages/vscode-extension/src/terminal/TerminalManager.ts`、`jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts` |

- [[ide-vscode-knowledge]]（ide-vscode：VS Code 聊天面板与终端命令镜像）
- [[feature-ide-terminal-command-mirror]]（IDE 终端命令镜像执行（VS Code 扩展与 JetBrains 插件））
- [[feature-depth-ide-terminal-command-mirror]]（IDE 终端命令镜像执行：实现深读）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-vscode/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-05；updated: 2026-10-05
