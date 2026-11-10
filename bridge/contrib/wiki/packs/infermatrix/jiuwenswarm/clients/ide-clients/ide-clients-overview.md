---
name: ide-clients-overview
description: IDE 客户端入口：VS Code 与 JetBrains 功能页、jetbrains-plugin 等四个源码目录、DiffApplier 与 Rewind 功能页的链接，及 ide clients 的代码快速入口表（JiuwenSwarmService.kt、ChatToolWindow.kt、DiffApplier.ts）
metadata:
  scope: 只收 ide-clients 目录的入口说明、链接和快速入口表；JetBrains 插件的架构与配置事实归 ide-clients-knowledge，源码接口记录归各子目录的 contracts 页
---
# ide-clients

## 现状

- 理解该代码 owner 的职责、接口、配置与相关功能时查这里；通用审查方法不属于本目录。
- [[feature-vscode]]（VS Code 客户端 功能知识）
- [[feature-jetbrains]]（JetBrains 客户端 功能知识）
- [[jetbrains-plugin-overview]]（jetbrains-plugin）
- [[jetbrains-plugin-src-overview]]（jetbrains-plugin-src）
- [[vscode-extension-overview]]（vscode-extension）
- [[vscode-extension-src-overview]]（vscode-extension-src）
- [[feature-depth-vscode]]（VS Code 客户端：实现深读）
- [[feature-depth-jetbrains]]（JetBrains 客户端：实现深读）

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：ide clients。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。
- （以下为原表格，按行改写为条目）
- PR 描述在做什么：ide clients
  - 精确规则：入口
  - 第一批 live 源码：`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/JiuwenSwarmService.kt`、`jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt`、
    - `jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts`
- [[ide-clients-knowledge]]（JetBrains 插件（ide-clients）：架构、API、配置与行为）
- [[feature-ide-file-edit-diff-apply]]（IDE 端代理文件编辑直接应用（DiffApplier））
- [[feature-ide-turn-rewind-snapshot]]（IDE 单轮文件快照与回退（Rewind））
- [[shared-webview-overview]]（shared-webview）
- [[feature-depth-ide-file-edit-diff-apply]]（IDE 端代理文件编辑直接应用（DiffApplier）：实现深读）
- [[feature-depth-ide-turn-rewind-snapshot]]（IDE 单轮文件快照与回退（Rewind）：实现深读）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
