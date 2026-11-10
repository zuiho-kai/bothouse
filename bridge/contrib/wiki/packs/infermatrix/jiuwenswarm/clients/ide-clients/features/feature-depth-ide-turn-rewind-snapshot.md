---
name: feature-depth-ide-turn-rewind-snapshot
description: 单轮快照与回退实现深读：handleRewind 空快照直接返回、promoteSnapshots / getLastTurnSnapshots / clearLastTurnSnapshots 导出、JetBrains rewindEnabled 默认 true、读取失败记 null 导致回退删除现存文件、文档化回退步骤（未执行）
metadata:
  scope: 只收 Rewind 的实现级事实（ChatPanel 与 DiffApplier 的快照状态、null 语义、验证）；功能概览与采集、晋升流程归 feature-ide-turn-rewind-snapshot，编辑应用的实现归 feature-depth-ide-file-edit-diff-apply
---
# IDE 单轮文件快照与回退（Rewind）：实现深读

## 现状

- [[feature-ide-turn-rewind-snapshot]]（功能概览） · [[ide-clients-overview]]（owner 入口）
- **handleRewind：空快照直接返回，否则恢复、清空并回报 rewind_done** handleRewind 先取 lastTurnSnapshots 的副本，若 size === 0 直接 return；否则 await performRewind，随后 clearLastTurnSnapshots，并按 failed 是否为 0 组装消息 postToWebview({type:'rewind_done', restored, failed})。
  - performRewind 内对每个条目：originalContent === null 且文件存在时 fs.unlinkSync 删除；非 null 时走恢复原内容分支（该写回语句体未在展示范围内）。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L929–L940](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L929-L940),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L245–L257](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L245-L257)
- **模块导出三个快照生命周期函数，promoteSnapshots 返回是否存在可回退文件** promoteSnapshots(): boolean 在 currentTurnSnapshots.size === 0 时返回 false，否则提升并返回 true；getLastTurnSnapshots(): Map<string, FileSnapshot> 返回拷贝；clearLastTurnSnapshots(): void 清空 lastTurnSnapshots；ensureSnapshot(filePath) 无返回值。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L32–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L32-L48),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L53–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L53-L64)
- **JetBrains 设置 rewindEnabled 默认 true，注释声明其用于快照/回退** JiuwenSwarmSettings.State 中 rewindEnabled: Boolean = true，注释为 "When true, snapshot files before agent edits so the rewind feature can become restore them." 的意图性说明（原文：snapshot files before agent edits so the rewind feature can restore them）。
  - 所示片段没有消费该开关的代码，因此其 gating 效果在本证据内未确立。
- 来源：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt:L36–L39
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt#L36-L39`）,
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt:L123–L125
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt#L123-L125`）
- **ChatPanel 的回退依赖 DiffApplier 的三个导出与模块级 Map 状态** handleRewind 调用 DiffApplier.getLastTurnSnapshots()（返回新 Map 副本）、performRewind(snapshots) 和 clearLastTurnSnapshots()。快照状态是 DiffApplier.ts 模块级变量 currentTurnSnapshots / lastTurnSnapshots；ensureSnapshot 用同步 fs.existsSync/readFileSync 写入，ChatPanel 不自持快照。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L929–L934](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts#L929-L934),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L22–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L22-L24),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L41–L53](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L41-L53)
- **读取失败时快照记为 null，回退会把现存文件当作本轮新建而删除** 设计推断（非作者历史意图）：
- ensureSnapshot 的 catch 分支将 currentTurnSnapshots.set(filePath, null)；performRewind 对 null 快照在 fs.existsSync 为真时执行 unlinkSync。即读取异常与"编辑前不存在"不可区分，回退会删除该文件。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L55–L63](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L55-L63),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L249–L255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L249-L255)
- **快照整份读入内存：省去外部存储，但 null 语义有歧义** ensureSnapshot 将文件全文以 utf-8 字符串读入内存 Map（L57），未落盘外部存储，实现简单；代价是 originalContent === null 同时表示文件原不存在（L59）与读取失败（L61-62）两种情况，performRewind 对 null 一律走删除分支（L251-255），读取失败时可能删除本已存在的文件。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L53–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L53-L64),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L245–L259](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L245-L259)
- **文档化的手工回退步骤（未执行）** 文档中的人工验收步骤（本轮未执行）：
- VSCode 插件指南记载：轮次编辑文件后消息列表下方出现回退栏，点击 "⟲ 撤销更改" 后扩展恢复每个被快照的文件、该轮前不存在的文件被删除，并以状态行 "⟲ 已回退 3 个文件" 确认；此为文档化手工流程，NOT EXECUTED，所示证据不含自动化测试。
- 来源：[docs/zh/ide/vscode/VSCode插件指南.md:L332–L362](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/vscode/VSCode%E6%8F%92%E4%BB%B6%E6%8C%87%E5%8D%97.md#L332-L362)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/feature-depth-ide-turn-rewind-snapshot.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L32-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L53-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt:L36-L39
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt:L123-L125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L55-L63
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L249-L255
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L929-L940
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L245-L257
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts:L929-L934
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L22-L24
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L41-L53
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L245-L259；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/vscode/VSCode插件指南.md:L332-L362
- 源页字段（feature）：ide-turn-rewind-snapshot
- 入口（entry_points）：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt；jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts
- 源页字段（source_globs）：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt；jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/settings/JiuwenSwarmSettings.kt
