---
name: feature-depth-ide-file-edit-diff-apply
description: DiffApplier 实现深读：handleToolCall 按 EDIT_TOOLS 与参数守卫分派、jiuwenswarm.approveEdits 默认 false、parseArguments 失败 console.warn 与 path 缺失静默返回 false、守卫静默的取舍、文档化手动验证（未执行）
metadata:
  scope: 只收 DiffApplier（VS Code 与 JetBrains）实现级事实，按流程、配置、依赖、失败模式、API、取舍、验证七个切面；职责、支持的编辑行为与整体取舍的概览归 feature-ide-file-edit-diff-apply，快照与回退的实现归 feature-depth-ide-turn-rewind-snapshot
---
# IDE 端代理文件编辑直接应用（DiffApplier）：实现深读

## 现状

- [[feature-ide-file-edit-diff-apply]]（功能概览） · [[ide-clients-overview]]（owner 入口）
- **handleToolCall 按 EDIT_TOOLS 与参数守卫分派 write_file 到 writeEntireFile** 回调先取 payload.tool_name，不在 EDIT_TOOLS 集合即返回 false；parseArguments 成功后从配置读 requireApproval。write_file/create_file 分支在 args.path 缺失时返回 false，否则以 isNew = create_file 或文件不存在 调 writeEntireFile 并返回其布尔结果。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L70–L85](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L70-L85),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L112–L123](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L112-L123),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L273–L286](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L273-L286)
- **VS Code 端审批开关 jiuwenswarm.approveEdits，默认 false** 每次调用通过 vscode.workspace.getConfiguration('jiuwenswarm').get('approveEdits', false) 读取，默认不要求审批，布尔值传入 applyStrReplace/writeEntireFile。JetBrains 端对应 settings.approveEdits 与 autoApplyEdits 两个设置。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L81–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L81-L83),
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L70–L78
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt#L70-L78`）
- **依赖 vscode 配置 API、fs 存在性检查与 EDIT_TOOLS 工具名集合** VS Code 分支依赖 vscode.workspace.getConfiguration 与 fs.existsSync 判定 isNew；JetBrains 端依赖 JiuwenSwarmSettings.instance() 提供设置，EDIT_TOOLS 集合限定四种工具名（str_replace_editor、write_file、create_file、edit_file）。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L112–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L112-L119),
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L309–L310
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt#L309-L310`）
- **参数不可解析时 console.warn 并返回 false；path 缺失静默返回 false** parseArguments 对非对象且非字符串的 arguments 或 JSON.parse 抛错返回 null；handleToolCall 据此记录 console.warn 后返回 false，不进入写分支。write_file 分支中 filePath 为空时直接 return false，无告警。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L75–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L75-L79),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L273–L286](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L273-L286),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L112–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L112-L119)
- **handleToolCall：异步入口，按 tool_name 过滤并在参数可解析时委托各工具分支** handleToolCall(event) 是 async、返回 Promise<boolean>；payload 缺 tool_name 或不在 EDIT_TOOLS 时返回 false，parseArguments 失败时 console.warn 并返回 false。
  - str_replace_editor 的 'str_replace' 分支要求 args.path 存在且 old_str 已定义（new_str 缺省为 ''），然后委托 applyStrReplace(filePath, oldStr, newStr, requireApproval)；'create' 委托 writeEntireFile。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L70–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L70-L82),
  - [jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L85–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L85-L102)
- **守卫不满足时静默返回 false：控制流简单但无用户提示** 设计推断（非作者历史意图）：
- （推断）入口对缺失或未列入 EDIT_TOOLS 的 tool_name 直接返回 false、不做提示，仅参数解析失败才 console.warn；这换来简单的调用方布尔语义，代价是守卫分支对用户不可见。
- 来源：[jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L70–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts#L70-L79)
- **文档化的手动验证：approveEdits 批准/拒绝提示（未执行）** 文档中的人工验收步骤（本轮未执行）：
- 文档写明：智能体调用 str_replace_editor / write_file / create_file 时扩展应用编辑并弹通知 toast；启用设置 jiuwenswarm.approveEdits 后每次变更前出现批准/拒绝提示，拒绝丢弃编辑、批准写入磁盘。此为文档步骤，标注 NOT EXECUTED，所示输入无自动化测试。
- 来源：[docs/zh/ide/vscode/VSCode插件指南.md:L307–L320](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/vscode/VSCode%E6%8F%92%E4%BB%B6%E6%8C%87%E5%8D%97.md#L307-L320)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/ide-clients/feature-depth-ide-file-edit-diff-apply.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L81-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L70-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L112-L119
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt:L309-L310
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L70-L85
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L112-L123
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L273-L286
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L75-L79
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L70-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L85-L102
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts:L70-L79；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/vscode/VSCode插件指南.md:L307-L320
- 源页字段（feature）：ide-file-edit-diff-apply
- 入口（entry_points）：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt；jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts
- 源页字段（source_globs）：jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/ui/ChatToolWindow.kt；jiuwenswarm/channels/ide/packages/vscode-extension/src/editor/DiffApplier.ts
  - jiuwenswarm/channels/ide/packages/jetbrains-plugin/src/main/kotlin/com/jiuwenswarm/plugin/editor/DiffApplier.kt；jiuwenswarm/channels/ide/packages/vscode-extension/src/ui/ChatPanel.ts
