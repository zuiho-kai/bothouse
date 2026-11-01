# 信任对话框的肯定选项识别（PR #810）

用量探针捕获过 `Yes, IGtrust this folder`。此前 PR 通过删除非字母字符后匹配 `trustthisfolder` 来兼容它，但也把标题 `Do you trust this folder?` 和否定句识别为肯定选项，导致选项索引错误。额外 G 的来源尚未证实，本次不修改终端渲染器或冷却策略。

## 行为

- 对话框可见性与肯定选项判断分开：标题或否定句仍能阻止通用 Enter 回退，但不能作为 Yes。
- 肯定选项只接受归一化后的完整 `Yes, I trust this folder` 和实测 `Yes, IGtrust this folder`；保留数字编号、空白、标点和光标符号的兼容。
- 看见完整且唯一的 Yes/No 选项后才计算按键；保留默认 No、默认 Yes、上下相反排列和既有无光标默认首项行为。
- 缺选项、重复选项、多光标、未知选项上的光标、选项之间插入未知文本均等待，不发送确认。

## 回归证据

调用链使用 `promptActionForScreen`、`nextClaudeUsageProbeAction` 和实际 `trustDialogAction`，没有替换内部判断。原有原始 PTY/CSI G 渲染测试继续覆盖终端输入。

1. `TestPromptActionForScreen_TrustDialogTitleIsNotYes` 在修正前失败：只有标题和 No 时返回 `\x1b[A\r`，预期等待；修正后通过。
2. `TestPromptActionForScreen_TrustDialogRequiresKnownOptions` 在收紧选项完整性前失败：缺 No、未知光标、插入未知选项、重复选项、多光标及残缺光标均错误发键；修正后通过。包括否定句、带 Yes 的否定句、附加文本、标题与默认位置的正反用例。
3. 完整 claudecode 包 race 测试通过；最终提交的检查和独立复核记录在 PR。

只修改屏幕识别与回归，不写本机信任配置、不调用真实 provider、不部署或重启；不能据此声称线上冷却已经恢复。
