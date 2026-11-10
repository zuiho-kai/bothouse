---
name: feature-vscode
description: VS Code 客户端的职责、接口与配置：activate / deactivate / cleanup / ensureWebviewHtml 入口、配置与生效条件、设计取舍与建议验收步骤（上下文、diff、文件链接、终端输出）
metadata:
  scope: 只收 VS Code 客户端的入口知识与查证路由；逐条实现细节归 feature-depth-vscode，JetBrains 客户端归 feature-jetbrains
---
# VS Code 客户端 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/feature-vscode.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/vscode/VSCode插件.md
- 源页字段（feature）：vscode
- 入口（entry_points）：jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts
- 源页字段（source_globs）：jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts；jiuwenswarm/channels/ide/packages/vscode-extension/*；jiuwenswarm/channels/ide/packages/shared-webview/chat.html；jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts
  - jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/StatusBar.ts；jiuwenswarm/channels/ide/packages/vscode-extension/src/client/protocol.ts；jiuwenswarm/channels/ide/packages/vscode-extension/src/client/WsClient.ts
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/SwarmMapPanel.kt；jiuwenswarm/channels/ide/packages/vscode-extension/esbuild.js；jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffViewer.ts
  - jiuwenswarm/channels/browser/frontend/src/webview/chat.html
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- IDE 客户端将聊天和工作区上下文连接到 JiuwenSwarm 服务。编辑器状态、工作区路径和协议会话之间有明确的适配边界，插件安装不等于后端已启动。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts:L1–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts#L1-L209)；
  - [docs/zh/ide/vscode/VSCode插件.md:L1–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/vscode/VSCode%E6%8F%92%E4%BB%B6.md#L1-L178)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `activate`；`deactivate`；`cleanup`；`ensureWebviewHtml`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts:L1–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts#L1-L209)；
  - [docs/zh/ide/vscode/VSCode插件.md:L1–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/vscode/VSCode%E6%8F%92%E4%BB%B6.md#L1-L178)。

### 配置入口与生效条件

- 配置与启用条件的权威入口是下列功能文档和实现的调用方。本页提供查证路由：先确认当前宿主、会话或运行模式，再检查文档中的操作条件与实现消费的输入；不把 UI 文案、文件名或方法名猜作可写配置键。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts:L1–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts#L1-L209)；
  - [docs/zh/ide/vscode/VSCode插件.md:L1–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/vscode/VSCode%E6%8F%92%E4%BB%B6.md#L1-L178)。

### 设计取舍

- **设计推断**：编辑器将选中内容、工作区与诊断附到聊天，并展示文件修改和终端输出，减少切换工具；代价是 VS Code 扩展与后端会话需同步项目身份。文件链接、快速修复与检查点是不同交互，插件加载完成不能代替后端已连接和修改已应用的验证。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts:L1–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts#L1-L209)；
  - [docs/zh/ide/vscode/VSCode插件.md:L1–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/vscode/VSCode%E6%8F%92%E4%BB%B6.md#L1-L178)。

### 数据流与关联功能

- IDE 客户端将聊天和工作区上下文连接到 JiuwenSwarm 服务。编辑器状态、工作区路径和协议会话之间有明确的适配边界，插件安装不等于后端已启动。 联调时结合[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（项目、会话与历史管理）、[[feature-lsp]]（LSP 代码智能）、[[feature-permissions-1]]、[[feature-permissions-2]]（工具权限与安全治理）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts:L1–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts#L1-L209)；
  - [docs/zh/ide/vscode/VSCode插件.md:L1–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/vscode/VSCode%E6%8F%92%E4%BB%B6.md#L1-L178)。

### 怎样验证

- 在代码工作区发送选中内容并完成最小修改，核对上下文、diff、文件链接与终端输出。验证快速修复、回退、会话恢复及断连提示，检查切换工作区后请求路径和项目规则正确。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts:L1–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/extension.ts#L1-L209)；
  - [docs/zh/ide/vscode/VSCode插件.md:L1–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/vscode/VSCode%E6%8F%92%E4%BB%B6.md#L1-L178)。
