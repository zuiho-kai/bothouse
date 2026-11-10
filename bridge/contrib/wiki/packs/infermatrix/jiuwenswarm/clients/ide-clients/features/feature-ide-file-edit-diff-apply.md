---
name: feature-ide-file-edit-diff-apply
description: IDE 端代理文件编辑直接应用（DiffApplier）：handleToolCall 入口与快照生命周期、str_replace_editor / edit_file / write_file / create_file 四类编辑、approveEdits / rewindEnabled / useDiffViewer 三项设置、默认直接应用与快照补偿的取舍
metadata:
  scope: 只收 DiffApplier 的入口、编辑行为、验证途径、职责数据流、配置与取舍概览；逐条实现细节归 feature-depth-ide-file-edit-diff-apply，快照回退功能归 feature-ide-turn-rewind-snapshot
---
# IDE 端代理文件编辑直接应用（DiffApplier）

## 现状

- **公开入口与生命周期**
- VS Code 版 `DiffApplier.ts` 的主入口是 `handleToolCall(event)`：解析 `chat.tool_call` 事件负载，若 tool_name 属于 EDIT_TOOLS（str_replace_editor / write_file / create_file / edit_file）则应用编辑并返回布尔值表示是否已处理。
  - 配套导出快照生命周期函数：`ensureSnapshot`、`clearSnapshots`、`promoteSnapshots`（chat.final 时调用）、`getLastTurnSnapshots`、`clearLastTurnSnapshots`，以及 `performRewind(snapshots)` 返回 `{restored, failed}`。JetBrains 版入口是 `DiffApplier.handle(project, event)`，非 EDT 线程调用时通过 `invokeAndWait` 跳转到 EDT 再分发到各工具处理函数。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L70–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L70-L84),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L27–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L27-L48),
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L44–L56
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt#L44-L56`）
- **支持的编辑行为**
- 支持四类工具调用：`str_replace_editor`（command 为 str_replace 或 create，参数 path/old_str/new_str 或 file_text）、`edit_file`（ACP 风格 file_path + old_string/new_string）、`write_file`/`create_file`（整文件 path+content）。字符串替换通过 `indexOf(oldStr)` 定位后拼接新文本；找不到目标文本或文件不存在时弹出错误通知并返回 false。写入新文件时会递归创建父目录。
  - 参数 arguments 既可为对象也可为 JSON 字符串（`parseArguments` 兼容两种）。配合快照机制提供按回合的 rewind（回滚到本回合首次编辑前的内容，含删除新建文件）。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L85–L123](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L85-L123),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L148–L164](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L148-L164),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L273–L286](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L273-L286)
- **验证入口**
- 所示文件片段中未包含针对 DiffApplier 的测试代码；可观察的验证途径是运行时的 `notify()` 通知（VS Code 版 showInformationMessage/showErrorMessage，JetBrains 版 NotificationGroup "JiuwenSwarm"）以及 ChatPanel 的 debug 日志（如 `SNAP →`、`DIFF → accepted/rejected`、`REWIND→`），用于人工确认快照、diff 接受与回滚行为。本组输入不足以判断仓库中是否存在自动化测试。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L288–L294](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L288-L294),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L368–L396](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L368-L396)
- **职责与数据流**
- DiffApplier 拦截 `chat.tool_call` 事件中的代理文件编辑工具调用（str_replace_editor / write_file / create_file / edit_file）并应用到 IDE 工作区，同时维护编辑前快照供 rewind 使用。
  - VS Code 端由 ChatPanel 驱动：解析事件后，若 `useDiffViewer` 开启则先计算提议内容并弹 diff（L388-L395：被拒绝时跳过 `handleToolCall`，事件仍转发给 webview；L397-L399：无法计算提议内容时回退为直接应用），否则直接调用 `DiffApplier.handleToolCall`；`chat.final` 时调用 `promoteSnapshots()`，仅当其返回 true（即本回合有快照）才向 webview 发送 `rewindable`。
  - JetBrains 端入口 `DiffApplier.handle(project, event)` 强制在 EDT 上执行（非 EDT 时 `invokeAndWait` 跳转），按 `autoApply` 决定写入还是仅显示 diff 对话框。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L5–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L5-L16),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L355–L404](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L355-L404),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L464–L471](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L464-L471),
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L44–L56
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt#L44-L56`）
- **配置项与读取方式**
- VS Code 端通过 `vscode.workspace.getConfiguration('jiuwenswarm')` 读取三项设置：`approveEdits`（默认 false，为 true 时每次编辑前弹 Approve/Reject 对话框，在 DiffApplier 内读取）、
  - `rewindEnabled`（默认 true，控制 ChatPanel 是否在工具调用前预先 `ensureSnapshot`）与 `useDiffViewer`（默认 false，为 true 时先计算提议内容并弹原生 diff，被拒绝则不调用 `handleToolCall`，无法计算提议内容时回退直接应用）。JetBrains 端从 `JiuwenSwarmSettings.instance()` 读取 `autoApplyEdits` 与 `approveEdits`：autoApply 为 true 时直接写入，否则仅显示 diff 对话框；
  - 该设置类的定义未在所示片段中给出。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L81–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L81-L84),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L368–L404](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L368-L404),
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L70–L78
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt#L70-L78`）
- **设计取舍：默认直接应用、整文件重写与快照补偿**
- Inference / 设计推断（非作者历史意图）：
- VS Code 端 `approveEdits` 默认为 false，即代理编辑默认不经确认直接写入工作区；作为补偿，模块在每回合首次编辑前用 `ensureSnapshot` 在内存中保存文件原文（不存在记为 null），`chat.final` 时提升为 lastTurn 快照供 rewind 删除新建文件或还原内容。
  - 另一取舍是所有编辑（包括单处 str_replace）都通过 `replaceWholeFile` 以整文件范围 WorkspaceEdit 重写并保存，而非最小化补丁——实现简单且天然覆盖新建文件路径，但找不到 old_str 时（indexOf < 0）整个编辑失败并仅弹通知。此外 ChatPanel 在 `useDiffViewer` 开启但无法计算提议内容时会回退为直接应用，即审查路径本身可被绕过。以上动机性分析为推断，所示输入无文档佐证。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L81–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L81-L84),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L50–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L50-L64),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L129–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L129-L146),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L387–L404](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L387-L404)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/feature-ide-file-edit-diff-apply.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L70-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L27-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L44-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L85-L123
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L148-L164
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L273-L286
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L288-L294
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L368-L396
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L5-L16
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L355-L404
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L464-L471
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L81-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L368-L404
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L70-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L50-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L129-L146
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L387-L404
- 源页字段（feature）：ide-file-edit-diff-apply
- 入口（entry_points）：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt；jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts
- 源页字段（source_globs）：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt；jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt；jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts
