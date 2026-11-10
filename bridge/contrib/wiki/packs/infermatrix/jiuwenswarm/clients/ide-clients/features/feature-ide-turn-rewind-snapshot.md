---
name: feature-ide-turn-rewind-snapshot
description: IDE 单轮文件快照与回退（Rewind）：rewindEnabled 开关、chat.tool_call 事件中的快照采集与晋升、JetBrains ChatToolWindow 的 rewind 消息入口与 WriteCommandAction 回退、验证用 debug 日志与 rewind_done 消息
metadata:
  scope: 只收 Rewind 功能的开关、采集、晋升、入口与回退行为概览；逐条实现深读归 feature-depth-ide-turn-rewind-snapshot，编辑应用归 feature-ide-file-edit-diff-apply
---
# IDE 单轮文件快照与回退（Rewind）

## 现状

- **rewindEnabled 开关**
- 快照采集受 `JiuwenSwarmSettings.instance().rewindEnabled` 布尔设置门控，仅在该设置为 true 且工具属于 `str_replace_editor`/`write_file`/`create_file`/`edit_file` 时才采集。所示 JiuwenSwarmSettings.kt 行段（30-34）未包含 rewindEnabled 的定义与默认值，默认行为无法从所示证据确认。
- Sources / 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L627–L630
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt#L627-L630`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt:L30–L34
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt#L30-L34`）
- **验证**
- 所示证据中未包含针对快照/回退的自动化测试；可观察的验证途径是运行期 debug 日志（"SNAP → snapshotted …"、"Rewind failed for …"）和 webview 收到的 `rewind_done` 计数消息。
- Sources / 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L503–L512
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt#L503-L512`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L641–L649
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt#L641-L649`）
- **采集、晋升与生命周期**
- 快照采集发生在 `chat.tool_call`/`chat.tool_update` 事件处理中：仅当 `JiuwenSwarmSettings.instance().rewindEnabled` 为 true 且工具名为 `str_replace_editor`/`write_file`/`create_file`/`edit_file` 时，从 arguments 的 `file_path`/`path` 取路径，对该路径首次出现时在 ReadAction 中读入原内容（文件不存在或读取抛异常时记 null）。恢复路径上，null 快照且文件存在时删除文件；
  - 非 null 快照仅当 VFS 中仍能找到该文件（`vf != null`）时才用 `setBinaryContent` 写回。用户发送新消息（"send"）时清空 current/last 快照并通知 webview `rewindable=false`；代码注释声明 chat.final 时将 current 晋升为 last，但该晋升的执行代码不在所示片段内。
- Sources / 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L622–L650
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt#L622-L650`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L494–L502
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt#L494-L502`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L315–L318
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt#L315-L318`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L113–L117
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt#L113-L117`）
- **入口与生命周期**
- JetBrains 侧入口是 ChatToolWindow 的 webview 消息处理分支：消息的 type 字段等于字符串 "rewind" 时触发回退；若无快照（lastTurnSnapshots 为空）直接返回，否则在 pooled 线程中对每个文件执行一次 WriteCommandAction（名称 "Rewind agent changes"），完成后向 webview 发送含 restored/failed 计数的 rewind_done 消息。
  - VS Code 侧 DiffApplier.ts 导出模块级快照 API：clearSnapshots()（清空当前与上一轮）、promoteSnapshots()（chat.final 时晋升并返回是否有可回退文件）、getLastTurnSnapshots()（返回副本）、clearLastTurnSnapshots() 和 ensureSnapshot(filePath)（本轮首次出现的路径才采集）。
- Sources / 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L486–L512
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt#L486-L512`）,
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L26–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L26-L64)
- **快照采集与回退行为**
- JetBrains 插件在 chat.tool_call/chat.tool_update 事件中，仅当 rewindEnabled 为 true 且工具名为 str_replace_editor/write_file/create_file/edit_file 时，按 file_path/path 取路径，每轮仅对首次出现的路径采集一次快照；文件不存在或读取抛异常时均记为 null（注释称 null 表示文件原本不存在，但 L641-L646 的 catch 分支在读取失败时同样存 null）。
  - 回退（webview 消息 "rewind"）对 null 快照的现存文件执行删除，对非 null 快照仅当 VFS 中仍能找到该文件时写回原内容。VS Code 侧 DiffApplier.ts 维护同构的 currentTurnSnapshots/lastTurnSnapshots 结构，ensureSnapshot 同样在读取失败时存 null，并由 promoteSnapshots 在 chat.final 时晋升。
- Sources / 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L627–L649
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt#L627-L649`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L486–L512
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt#L486-L512`）,
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L32–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L32-L64)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/feature-ide-turn-rewind-snapshot.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L627-L630
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt:L30-L34
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L503-L512
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L641-L649
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L622-L650
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L494-L502
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L315-L318
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L113-L117
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L486-L512
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L26-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt:L627-L649
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L32-L64
- 源页字段（feature）：ide-turn-rewind-snapshot
- 入口（entry_points）：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt；jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts
- 源页字段（source_globs）：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt；jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt
